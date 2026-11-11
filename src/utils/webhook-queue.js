/**
 * Queue persistante de livraison des webhooks sortants + worker de reprise.
 *
 * Problème : `webhook-dispatcher.js` envoie en « best-effort » — si le
 * partenaire est momentanément down, l'événement est perdu.
 * Solution : on persiste chaque envoi dans `webhook_deliveries`, puis un
 * worker en process scanne périodiquement les lignes `pending` dues et
 * réessaie avec backoff exponentiel (2^attempt × base, borné à 1h).
 *
 * Pas de dépendance Redis/BullMQ : Postgres fait le même travail pour une
 * volumétrie pilote. Si le volume explose, extraire vers un worker dédié
 * sera trivial (même schéma de table).
 */

import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { dispatchWebhook } from './webhook-dispatcher.js';

const BACKOFF_BASE_MS = 30_000; // 30s, 1min, 2min, 4min, 8min, 16min, 32min…
const BACKOFF_MAX_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 20;

let workerTimer = null;
let workerRunning = false;

function computeBackoffMs(attempt) {
  // attempt 1 → base, attempt 2 → 2×base, etc. Cap à BACKOFF_MAX_MS.
  const exp = Math.min(attempt, 12);
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, exp - 1), BACKOFF_MAX_MS);
}

/**
 * Persiste une tentative d'envoi webhook. Le worker la prendra en charge
 * dès que `nextAttemptAt` arrive (par défaut : immédiat).
 */
export async function enqueueWebhook({
  partnerKeyId,
  partnerName,
  url,
  secret,
  eventType,
  payload,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  if (typeof secret !== 'string' || secret.length < 8) return null;

  try {
    return await prisma.webhookDelivery.create({
      data: {
        partnerKeyId: partnerKeyId ?? 'unknown',
        partnerName: partnerName ?? partnerKeyId ?? 'unknown',
        url,
        secret,
        eventType,
        payload: payload ?? {},
        maxAttempts
      }
    });
  } catch (error) {
    logger.warn(
      { component: 'webhook-queue', eventType, error: error.message },
      'Impossible de persister le webhook — envoi perdu'
    );
    return null;
  }
}

/**
 * Essaie une livraison. En cas d'échec, replanifie avec backoff
 * exponentiel ; au terme des tentatives, marque la ligne `dead`.
 */
async function processDelivery(row) {
  const attempt = row.attempts + 1;
  const result = await dispatchWebhook({
    url: row.url,
    secret: row.secret,
    eventType: row.eventType,
    data: row.payload
  });

  if (result.ok) {
    await prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: 'delivered',
        attempts: attempt,
        lastStatusCode: result.status,
        lastError: null,
        deliveredAt: new Date()
      }
    });
    logger.info(
      {
        component: 'webhook-queue',
        partner: row.partnerName,
        eventType: row.eventType,
        attempt
      },
      'Webhook livré'
    );
    return;
  }

  const giveUp = attempt >= row.maxAttempts;
  const backoffMs = computeBackoffMs(attempt);
  const next = new Date(Date.now() + backoffMs);

  await prisma.webhookDelivery.update({
    where: { id: row.id },
    data: {
      status: giveUp ? 'dead' : 'pending',
      attempts: attempt,
      lastStatusCode: result.status,
      lastError: result.error ?? null,
      nextAttemptAt: giveUp ? row.nextAttemptAt : next
    }
  });

  logger.warn(
    {
      component: 'webhook-queue',
      partner: row.partnerName,
      eventType: row.eventType,
      attempt,
      maxAttempts: row.maxAttempts,
      status: result.status,
      retryInMs: giveUp ? null : backoffMs
    },
    giveUp ? 'Webhook abandonné après trop d\'échecs' : 'Webhook à retenter'
  );
}

/**
 * Tick du worker : prend jusqu'à BATCH_SIZE livraisons `pending` dues et
 * les traite en parallèle. Rien ne peut faire tomber le process (toutes
 * les erreurs sont loggées, pas propagées).
 */
export async function tickWebhookWorker({ now = new Date() } = {}) {
  let batch;
  try {
    batch = await prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH_SIZE
    });
  } catch (error) {
    logger.warn(
      { component: 'webhook-queue', error: error.message },
      'Lecture queue webhook impossible'
    );
    return { processed: 0 };
  }
  if (batch.length === 0) return { processed: 0 };

  await Promise.allSettled(batch.map(processDelivery));
  return { processed: batch.length };
}

/**
 * Démarre un worker in-process qui appelle `tickWebhookWorker` toutes les
 * `intervalMs`. Idempotent (un seul worker même si appelé plusieurs fois).
 * En tests, préférer appeler `tickWebhookWorker` à la main.
 */
export function startWebhookWorker({ intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  if (workerTimer) return workerTimer;
  const run = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await tickWebhookWorker();
    } finally {
      workerRunning = false;
    }
  };
  workerTimer = setInterval(run, intervalMs);
  // `unref` : pas de blocage au shutdown du process.
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
  return workerTimer;
}

export function stopWebhookWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

export const WEBHOOK_QUEUE_CONSTANTS = Object.freeze({
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
  BATCH_SIZE
});
