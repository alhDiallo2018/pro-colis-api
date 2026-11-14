/**
 * Dashboard pilote 14-jours (OPS-4).
 *
 * Agrège les flux Phase 1-6 sur une fenêtre glissante de 14 jours :
 *   - parcels créés / livrés / annulés
 *   - handovers initiés / confirmés / annulés
 *   - journey_stop_events (arrivées GPS géofencées)
 *   - advertisement_offers acceptées
 *   - webhook_deliveries sortants (par statut)
 *   - whatsapp_dispatches (par statut)
 *   - anomaly_events par type
 *
 * Volontairement synchrone côté Prisma (une requête par agrégat, parallélisées
 * via Promise.all). Sortie strictement numérique — jamais d'identifiants
 * d'utilisateurs ou de messages. Convient à un dashboard admin et à un
 * export pour reporting commercial.
 */

const DEFAULT_WINDOW_DAYS = 14;

export async function build14dPilotMetrics(prisma, { windowDays = DEFAULT_WINDOW_DAYS, now = new Date() } = {}) {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [
    parcelByStatus,
    handoverByStatus,
    stopEventsCount,
    offerAcceptedCount,
    webhookByStatus,
    whatsappByStatus,
    anomalyByType,
    customsSignedCount,
    batchByStatus
  ] = await Promise.all([
    prisma.parcel.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true }
    }),
    prisma.parcelHandover.groupBy({
      by: ['status'],
      where: { initiatedAt: { gte: since } },
      _count: { _all: true }
    }),
    prisma.journeyStopEvent.count({ where: { reachedAt: { gte: since } } }),
    prisma.advertisementOffer.count({
      where: { respondedAt: { gte: since }, status: 'accepted' }
    }),
    prisma.webhookDelivery.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true }
    }),
    prisma.whatsAppDispatch.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true }
    }).catch(() => []),
    prisma.anomalyEvent.groupBy({
      by: ['type'],
      where: { detectedAt: { gte: since } },
      _count: { _all: true }
    }).catch(() => []),
    prisma.parcelCustoms.count({ where: { signedAt: { gte: since } } }),
    prisma.shipmentBatch.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true }
    })
  ]);

  const toMap = (rows, keyField = 'status') =>
    Object.fromEntries(rows.map((r) => [r[keyField], r._count._all]));

  return {
    window: {
      days: windowDays,
      from: since.toISOString(),
      to: now.toISOString()
    },
    parcels: toMap(parcelByStatus),
    handovers: toMap(handoverByStatus),
    stopEvents: stopEventsCount,
    offersAccepted: offerAcceptedCount,
    webhooks: toMap(webhookByStatus),
    whatsapp: toMap(whatsappByStatus),
    anomalies: toMap(anomalyByType, 'type'),
    customsSigned: customsSignedCount,
    shipmentBatches: toMap(batchByStatus)
  };
}

export const PILOT_METRICS_DEFAULT_WINDOW_DAYS = DEFAULT_WINDOW_DAYS;
