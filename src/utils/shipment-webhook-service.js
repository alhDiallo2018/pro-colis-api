/**
 * Service de diffusion d'événements colis vers les partenaires e-commerce
 * via webhook sortant.
 *
 * Point d'entrée unique : `dispatchShipmentEvent({ type, parcel })`. Lit
 * les clés API partenaires actives dans SystemConfig (`apiKeys.business.*`)
 * et envoie l'événement signé HMAC à chaque `webhookUrl` configuré.
 *
 * Volontairement « fire-and-forget » (jamais d'exception vers le caller) :
 * un flux métier ne doit pas être bloqué parce qu'un partenaire est down.
 * Les échecs sont journalisés par `webhook-dispatcher`. Les retries et la
 * persistence d'une queue de reprise sont prévus pour V2.
 */

import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { enqueueWebhook } from './webhook-queue.js';

const CONFIG_PREFIX = 'apiKeys.business.';
const CACHE_TTL_MS = 60_000;

let cachedPartners = null;
let cachedAt = 0;

/**
 * Charge les partenaires actifs depuis SystemConfig, avec un cache 60 s.
 * Les valeurs sont attendues sous la forme :
 *   { keyHash, partnerName, webhookUrl, webhookSecret, scopes, active }.
 */
async function loadActivePartners() {
  const now = Date.now();
  if (cachedPartners && now - cachedAt < CACHE_TTL_MS) return cachedPartners;

  try {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { startsWith: CONFIG_PREFIX } }
    });
    cachedPartners = rows
      .map((row) => {
        const value = row.value && typeof row.value === 'object' ? row.value : null;
        if (!value) return null;
        if (value.active === false) return null;
        if (typeof value.webhookUrl !== 'string' || typeof value.webhookSecret !== 'string') return null;
        return {
          keyId: row.key.slice(CONFIG_PREFIX.length),
          partnerName: value.partnerName ?? row.key,
          webhookUrl: value.webhookUrl,
          webhookSecret: value.webhookSecret,
          scopes: Array.isArray(value.scopes) ? value.scopes : []
        };
      })
      .filter(Boolean);
    cachedAt = now;
    return cachedPartners;
  } catch (error) {
    logger.warn(
      { component: 'shipment-webhook', error: error.message },
      "Lecture partenaires webhook impossible"
    );
    cachedPartners = [];
    cachedAt = now;
    return cachedPartners;
  }
}

export function invalidatePartnersCache() {
  cachedPartners = null;
  cachedAt = 0;
}

/**
 * Serialise un colis en payload partenaire : uniquement les champs
 * publics et stables. Jamais de données internes (ids internes privés,
 * données sensibles du chauffeur, soldes).
 */
function toPublicShipmentPayload(parcel) {
  if (!parcel) return null;
  return {
    trackingNumber: parcel.trackingNumber,
    status: parcel.status,
    weightKg: parcel.weight != null ? Number(parcel.weight) : null,
    departureCity:
      parcel.departureZone?.city ??
      parcel.departureZone?.name ??
      parcel.departureGarage?.city ??
      null,
    arrivalCity:
      parcel.arrivalZone?.city ??
      parcel.arrivalZone?.name ??
      parcel.arrivalGarage?.city ??
      null,
    pickupDate: parcel.pickupDate ? parcel.pickupDate.toISOString() : null,
    deliveryDate: parcel.deliveryDate ? parcel.deliveryDate.toISOString() : null,
    estimatedDeliveryDate: parcel.estimatedDeliveryDate
      ? parcel.estimatedDeliveryDate.toISOString()
      : null,
    updatedAt: parcel.updatedAt ? parcel.updatedAt.toISOString() : null
  };
}

/**
 * Diffuse un événement colis à tous les partenaires actifs disposant du
 * scope requis. Attend un parcel déjà chargé avec ses zones/garages
 * (via `parcelInclude` recommandé). JAMAIS d'exception vers le caller.
 *
 * @param {object} args
 * @param {string} args.type   ex: 'shipment.updated', 'shipment.delivered'
 * @param {object} args.parcel
 * @param {string} [args.requiredScope]  défaut 'shipments.read'
 * @returns {Promise<{ queued: number, eligible: number }>}
 */
export async function dispatchShipmentEvent({
  type,
  parcel,
  requiredScope = 'shipments.read'
} = {}) {
  // Les entrées invalides retournent l'ancien shape pour que les callers
  // conditionnels (`if (r.sent === 0)`) ne cassent pas pendant la bascule.
  if (typeof type !== 'string' || !type) return { sent: 0, failed: 0 };
  const payload = toPublicShipmentPayload(parcel);
  if (!payload) return { sent: 0, failed: 0 };

  const partners = await loadActivePartners();
  const eligible = partners.filter((p) => p.scopes.includes(requiredScope));
  if (eligible.length === 0) return { queued: 0, eligible: 0 };

  // Les tentatives sont désormais persistées : un partenaire down ne perd
  // plus l'événement. Le worker in-process (`webhook-queue`) reprend avec
  // backoff exponentiel jusqu'à `maxAttempts`.
  let queued = 0;
  for (const partner of eligible) {
    const row = await enqueueWebhook({
      partnerKeyId: partner.keyId,
      partnerName: partner.partnerName,
      url: partner.webhookUrl,
      secret: partner.webhookSecret,
      eventType: type,
      payload
    });
    if (row) queued += 1;
    else {
      logger.warn(
        { component: 'shipment-webhook', partner: partner.partnerName, type },
        'Webhook partenaire non enregistré en queue'
      );
    }
  }
  return { queued, eligible: eligible.length };
}
