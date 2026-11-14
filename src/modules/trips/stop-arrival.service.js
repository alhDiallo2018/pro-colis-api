import { detectStopArrival, STOP_ARRIVAL_DEFAULTS } from '../../utils/stop-arrival-detector.js';
import { sendParcelStatusWhatsApp } from '../../utils/whatsapp.js';
import { dispatchShipmentEvent } from '../../utils/shipment-webhook-service.js';

// Taille maximale du ring buffer `recent_positions` sur JourneyLive.
// 10 positions à ~10 s d'intervalle couvrent 100 s, largement suffisant pour
// confirmer une arrivée (2-3 points consécutifs dans le rayon).
const RING_BUFFER_SIZE = 10;

function parseRecent(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const latitude = Number(entry.latitude ?? entry.lat);
      const longitude = Number(entry.longitude ?? entry.lng);
      const t = entry.capturedAt ?? entry.t;
      const capturedAt = t ? new Date(t) : null;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      if (!(capturedAt instanceof Date) || !Number.isFinite(capturedAt.getTime())) return null;
      return { latitude, longitude, capturedAt };
    })
    .filter(Boolean);
}

/**
 * Push une nouvelle position dans le ring buffer `recent_positions`.
 *
 * @param {Array} previous - buffer actuel (déjà parsé)
 * @param {{latitude: number, longitude: number, capturedAt: Date}} next
 * @returns {Array} nouveau buffer (max RING_BUFFER_SIZE entries, triées chronologiquement)
 */
export function appendPosition(previous, next) {
  const merged = [...(previous || []), {
    latitude: Number(next.latitude),
    longitude: Number(next.longitude),
    capturedAt: next.capturedAt instanceof Date ? next.capturedAt.toISOString() : new Date(next.capturedAt).toISOString()
  }];
  // Trie chronologiquement et tronque à la fin.
  merged.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  if (merged.length > RING_BUFFER_SIZE) {
    return merged.slice(-RING_BUFFER_SIZE);
  }
  return merged;
}

/**
 * Évalue l'arrivée aux arrêts pour un trajet navette puis persiste les nouveaux
 * événements dans `journey_stop_events`. Jamais bloquant : toute erreur retourne
 * un résultat vide sans lever.
 *
 * @param {object} tx - instance Prisma (transaction ou client).
 * @param {object} journeyLive - row JourneyLive avec `advertisement.transitLineId`.
 * @param {Array} recentPositionsRaw - valeur JSON actuelle de `recent_positions`.
 * @param {object} [config] - overrides du détecteur.
 * @returns {Promise<{reached: Array, nearest: object|null}>}
 */
export async function evaluateStopArrival(tx, journeyLive, recentPositionsRaw, config = {}) {
  try {
    if (!journeyLive?.advertisement?.transitLineId) {
      return { reached: [], nearest: null };
    }
    const transitLineId = journeyLive.advertisement.transitLineId;
    const stops = await tx.transitLineStop.findMany({
      where: { transitLineId },
      include: { zone: { select: { latitude: true, longitude: true, radiusKm: true } } },
      orderBy: { order: 'asc' }
    });
    if (!stops.length) return { reached: [], nearest: null };

    const alreadyReached = await tx.journeyStopEvent.findMany({
      where: { advertisementId: journeyLive.advertisementId },
      select: { stopOrder: true }
    });
    const alreadyReachedOrders = alreadyReached.map((r) => r.stopOrder);

    const detectorStops = stops.map((s) => ({
      order: s.order,
      label: s.label,
      zoneId: s.zoneId,
      zone: {
        latitude: Number(s.zone.latitude),
        longitude: Number(s.zone.longitude),
        radiusKm: s.zone.radiusKm != null ? Number(s.zone.radiusKm) : null
      }
    }));

    const parsed = parseRecent(recentPositionsRaw);
    const { stopReached, nearest } = detectStopArrival({
      recentPositions: parsed,
      stops: detectorStops,
      alreadyReachedOrders,
      config
    });

    const persisted = [];
    for (const ev of stopReached) {
      // upsert pour tolérer la race entre deux updateJourneyLive proches.
      const row = await tx.journeyStopEvent.upsert({
        where: {
          advertisementId_stopOrder: {
            advertisementId: journeyLive.advertisementId,
            stopOrder: ev.order
          }
        },
        create: {
          advertisementId: journeyLive.advertisementId,
          driverId: journeyLive.driverId,
          vehicleId: journeyLive.vehicleId,
          transitLineId,
          stopOrder: ev.order,
          stopLabel: ev.label,
          zoneId: ev.zoneId,
          distanceMeters: ev.distanceMeters,
          radiusMeters: ev.radiusMeters,
          reachedAt: new Date(ev.reachedAt),
          confirmedBy: ev.confirmedBy
        },
        update: {}
      });
      persisted.push({ event: ev, row });
    }

    // Phase 1 — SCP-004 : notifier les destinataires dont le dropOffStop est
    // atteint. Non bloquant : toute erreur est avalée pour ne pas casser le flux GPS.
    const notified = [];
    const webhooksQueued = [];
    for (const { event } of persisted) {
      try {
        const count = await notifyRecipientsAtDropOff(tx, journeyLive, event);
        notified.push({ stopOrder: event.order, recipients: count });
      } catch { /* non bloquant */ }
      // Phase 3 — SCP-021 : webhook partenaires e-commerce sur stop_reached.
      try {
        const queued = await dispatchStopReachedWebhooks(tx, journeyLive, event);
        webhooksQueued.push({ stopOrder: event.order, queued });
      } catch { /* non bloquant */ }
    }

    return { reached: stopReached, nearest, notified, webhooksQueued };
  } catch (err) {
    // Ne jamais bloquer le flux GPS pour un échec du détecteur.
    return { reached: [], nearest: null, error: err.message };
  }
}

/**
 * Notifie les destinataires dont le colis doit descendre à l'arrêt venant d'être
 * atteint. Pour chaque `AdvertisementOffer` acceptée avec `dropOffStopOrder == event.order` :
 *  - crée une Notification (le middleware push déclenche l'envoi FCM automatiquement),
 *  - envoie un WhatsApp template `out_for_delivery` si le client est opt-in et
 *    que l'offre référence un colis avec un numéro de suivi.
 *
 * @returns {Promise<number>} nombre de destinataires notifiés.
 */
export async function notifyRecipientsAtDropOff(tx, journeyLive, event) {
  const offers = await tx.advertisementOffer.findMany({
    where: {
      advertisementId: journeyLive.advertisementId,
      status: 'accepted',
      dropOffStopOrder: event.order
    },
    include: {
      client: { select: { id: true, fullName: true, phone: true, whatsappOptIn: true } },
      parcel: { select: { id: true, trackingNumber: true, receiverName: true } }
    }
  });

  if (!offers.length) return 0;

  const title = 'Votre colis approche';
  const stopLabel = event.label ?? `arrêt ${event.order}`;

  for (const offer of offers) {
    const parcelLabel = offer.parcel?.trackingNumber ? ` (${offer.parcel.trackingNumber})` : '';
    const body = `Le véhicule vient d'atteindre « ${stopLabel} »${parcelLabel}. Préparez-vous à récupérer votre colis.`;
    try {
      await tx.notification.create({
        data: {
          userId: offer.clientId,
          parcelId: offer.parcelId ?? null,
          senderName: 'PRO COLIS',
          type: 'stop_reached',
          title,
          body,
          data: {
            advertisementId: journeyLive.advertisementId,
            stopOrder: event.order,
            stopLabel: event.label,
            zoneId: event.zoneId,
            parcelId: offer.parcelId
          },
          priority: 'high'
        }
      });
    } catch { /* non bloquant */ }

    // WhatsApp optionnel : nécessite opt-in + numéro + colis identifiable.
    if (offer.client?.whatsappOptIn && offer.client.phone && offer.parcel?.trackingNumber) {
      try {
        await sendParcelStatusWhatsApp({
          phone: offer.client.phone,
          trackingNumber: offer.parcel.trackingNumber,
          status: 'out_for_delivery',
          recipientName: offer.parcel.receiverName || offer.client.fullName || 'Client',
          parcelId: offer.parcelId
        });
      } catch { /* non bloquant */ }
    }
  }

  return offers.length;
}

/**
 * Diffuse un événement `stop_reached` aux partenaires e-commerce pour chaque
 * offre acceptée dont `dropOffStopOrder == event.order` et qui référence un
 * colis. Payload public enrichi de `stopOrder`, `stopLabel`, `zoneId` et
 * `distanceMeters` via le mécanisme `extraPayload` de `dispatchShipmentEvent`.
 * Non bloquant.
 *
 * @returns {Promise<number>} nombre de parcels pour lesquels un webhook a été dispatché.
 */
export async function dispatchStopReachedWebhooks(tx, journeyLive, event) {
  const offers = await tx.advertisementOffer.findMany({
    where: {
      advertisementId: journeyLive.advertisementId,
      status: 'accepted',
      dropOffStopOrder: event.order,
      parcelId: { not: null }
    },
    include: {
      parcel: {
        include: {
          departureZone: { select: { city: true, name: true } },
          arrivalZone: { select: { city: true, name: true } },
          departureGarage: { select: { city: true } },
          arrivalGarage: { select: { city: true } }
        }
      }
    }
  });
  if (!offers.length) return 0;

  let dispatched = 0;
  for (const offer of offers) {
    if (!offer.parcel) continue;
    try {
      const r = await dispatchShipmentEvent({
        type: 'stop_reached',
        parcel: offer.parcel,
        extraPayload: {
          stopOrder: event.order,
          stopLabel: event.label,
          zoneId: event.zoneId,
          distanceMeters: event.distanceMeters,
          advertisementId: journeyLive.advertisementId
        }
      });
      if ((r?.queued ?? 0) > 0) dispatched += 1;
    } catch { /* non bloquant */ }
  }
  return dispatched;
}

export const STOP_ARRIVAL_RING_BUFFER_SIZE = RING_BUFFER_SIZE;
export { STOP_ARRIVAL_DEFAULTS };
