/**
 * Dispatcher de webhooks sortants pour l'API publique e-commerce.
 *
 * Signe chaque payload avec HMAC-SHA256 (header `X-SendProColis-Signature`)
 * pour que le partenaire puisse vérifier l'authenticité. Jamais d'exception
 * vers le caller : un webhook qui échoue ne doit pas bloquer la mise à jour
 * métier qui l'a déclenché. Retries exponentiels côté worker (TODO V2).
 *
 * Service pur côté signature + fetch, testable en mockant `fetch`.
 */

import { createHmac } from 'node:crypto';

import { logger } from '../config/logger.js';

const DEFAULT_TIMEOUT_MS = 5000;
const SIGNATURE_HEADER = 'X-SendProColis-Signature';
const EVENT_HEADER = 'X-SendProColis-Event';
const TIMESTAMP_HEADER = 'X-SendProColis-Timestamp';

/**
 * Signe un payload JSON avec HMAC-SHA256.
 * Retourne la signature hex. Format attendu par le partenaire :
 * `t=<unix>,v1=<hex>` (compatible avec le pattern Stripe-like).
 *
 * @param {string} payload  JSON déjà sérialisé (immuable)
 * @param {string} secret
 * @param {number} timestampMs
 */
export function signWebhook(payload, secret, timestampMs) {
  const signedString = `${timestampMs}.${payload}`;
  const hex = createHmac('sha256', secret).update(signedString).digest('hex');
  return `t=${timestampMs},v1=${hex}`;
}

/**
 * Vérifie la signature reçue depuis le partenaire (round-trip). Tolère un
 * décalage de 5 min pour les signatures datées.
 */
export function verifyWebhook(payload, secret, signatureHeader, { maxAgeMs = 5 * 60 * 1000, now = Date.now() } = {}) {
  if (typeof signatureHeader !== 'string') return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k?.trim(), v?.trim()];
    })
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(ts) || typeof v1 !== 'string') return false;
  if (Math.abs(now - ts) > maxAgeMs) return false;
  const expected = signWebhook(payload, secret, ts).split(',')[1].slice(3);
  // Comparaison constante — pas critique en V1, les deux chaînes sont courtes.
  return v1.length === expected.length && v1 === expected;
}

/**
 * POST d'un événement vers un endpoint partenaire. Jamais d'exception.
 *
 * Retries exponentiels : persistés par `webhook-queue.js`. Ici on reste
 * sur une tentative unique — le queue decide de la retenter ou non selon
 * le résultat (`ok` false → replanifié).
 *
 * @param {object} args
 * @param {string} args.url
 * @param {string} args.secret
 * @param {string} args.eventType  ex: 'shipment.updated'
 * @param {object} args.data       payload métier
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ok: boolean, status: number|null, error: string|null}>}
 */
export async function dispatchWebhook({
  url,
  secret,
  eventType,
  data,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    logger.warn({ component: 'webhook', url, eventType }, 'URL webhook invalide — envoi ignoré');
    return { ok: false, status: null, error: 'invalid_url' };
  }
  if (typeof secret !== 'string' || secret.length < 8) {
    logger.warn({ component: 'webhook', eventType }, 'Secret webhook trop court — envoi ignoré');
    return { ok: false, status: null, error: 'invalid_secret' };
  }

  const ts = Date.now();
  const payload = JSON.stringify({ event: eventType, data, createdAt: new Date(ts).toISOString() });
  const signature = signWebhook(payload, secret, ts);

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SIGNATURE_HEADER]: signature,
        [EVENT_HEADER]: eventType,
        [TIMESTAMP_HEADER]: String(ts)
      },
      body: payload,
      signal: controller.signal
    });
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : `http_${response.status}`
    };
  } catch (error) {
    logger.warn(
      { component: 'webhook', eventType, error: error.message },
      'Envoi webhook impossible'
    );
    return { ok: false, status: null, error: error.message || 'network_error' };
  } finally {
    clearTimeout(abortTimer);
  }
}

export const WEBHOOK_CONSTANTS = Object.freeze({
  SIGNATURE_HEADER,
  EVENT_HEADER,
  TIMESTAMP_HEADER,
  DEFAULT_TIMEOUT_MS
});
