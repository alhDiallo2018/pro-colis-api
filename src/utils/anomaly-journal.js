/**
 * Journalisation des anomalies détectées pour alimenter les métriques pilote.
 *
 * `detectAnomalies` (service pur) retourne des findings à chaque appel ;
 * on persiste chaque finding dans `anomaly_events` pour en tirer des
 * compteurs côté dashboard pilote. On déduplique dans une fenêtre courte
 * (10 min par défaut) pour éviter de ré-enregistrer une anomalie qui
 * persiste sur plusieurs tracks successifs du même colis.
 *
 * Jamais d'exception vers le caller : les métriques ne doivent pas casser
 * le flux temps-réel qui a déclenché la détection.
 */

import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';

const DEDUP_WINDOW_MS = 10 * 60 * 1000;

// Map snake_case du détecteur → camelCase schema/pilot metrics.
const TYPE_MAPPING = Object.freeze({
  gps_silence: 'gpsSilence',
  prolonged_stop: 'prolongedStop',
  route_deviation: 'routeDeviation'
});

function normalizeType(raw) {
  return TYPE_MAPPING[raw] ?? raw;
}

/**
 * Persiste un batch de findings pour un colis donné. Déduplique sur
 * (parcelId, type) dans la fenêtre récente.
 *
 * @param {object} args
 * @param {string|null} args.parcelId
 * @param {Array<{type: string, severity?: string, details?: object}>} args.findings
 * @returns {Promise<{persisted: number}>}
 */
export async function journalizeAnomalies({ parcelId, findings = [] } = {}) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return { persisted: 0 };
  }

  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  let existing = [];
  if (parcelId) {
    try {
      existing = await prisma.anomalyEvent.findMany({
        where: { parcelId, detectedAt: { gte: since } },
        select: { type: true }
      });
    } catch (error) {
      // Table absente ou DB momentanément down : on tente la persistence
      // des findings malgré tout — le filtre de dédup reste best-effort.
      logger.warn(
        { component: 'anomaly-journal', error: error.message },
        'Lecture dédup anomalies impossible'
      );
    }
  }
  const seenTypes = new Set(existing.map((e) => e.type));

  const toPersist = [];
  for (const finding of findings) {
    if (!finding || typeof finding.type !== 'string') continue;
    const type = normalizeType(finding.type);
    if (seenTypes.has(type)) continue;
    seenTypes.add(type);
    toPersist.push({
      parcelId: parcelId ?? null,
      type,
      severity: typeof finding.severity === 'string' ? finding.severity : 'info',
      details: finding.details ?? null
    });
  }

  if (toPersist.length === 0) return { persisted: 0 };

  try {
    await prisma.anomalyEvent.createMany({ data: toPersist });
    return { persisted: toPersist.length };
  } catch (error) {
    logger.warn(
      { component: 'anomaly-journal', error: error.message },
      "Journalisation anomalies impossible"
    );
    return { persisted: 0 };
  }
}

/**
 * Compte par type depuis `anomaly_events`, borné à la fenêtre donnée.
 * Retourne 0 par type si la table est vide ou absente.
 */
export async function countAnomaliesSince(since) {
  const buckets = {
    gpsSilence: 0,
    prolongedStop: 0,
    routeDeviation: 0
  };
  try {
    const rows = await prisma.anomalyEvent.groupBy({
      by: ['type'],
      where: since ? { detectedAt: { gte: since } } : undefined,
      _count: true
    });
    for (const row of rows) {
      if (row.type in buckets) {
        buckets[row.type] = row._count ?? 0;
      }
    }
  } catch (error) {
    logger.warn(
      { component: 'anomaly-journal', error: error.message },
      'Compte anomalies impossible'
    );
  }
  return buckets;
}
