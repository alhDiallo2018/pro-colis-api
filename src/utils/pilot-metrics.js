/**
 * Agrégation de métriques pilote — service pur (pas de DB).
 *
 * Prend des compteurs bruts (obtenus par `prisma.<model>.count(...)` côté
 * controller) et retourne un rapport structuré pour le dashboard
 * super-admin pilot. Volontairement dissocié des accès DB pour rester
 * testable sans Postgres.
 */

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function safeCount(v) {
  return isFiniteNumber(v) && v >= 0 ? Math.round(v) : 0;
}

function pct(numerator, denominator) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Construit un snapshot métriques à partir de compteurs bruts.
 *
 * @param {object} raw
 * @param {{ total: number, pending: number, triggered: number }} raw.referrals
 * @param {{ active: number, claimed: number, cancelled: number }} raw.insurance
 * @param {{ active: number, total: number }} raw.apiKeys
 * @param {{ sent: number, delivered: number, read: number }} [raw.whatsapp]
 * @param {{ requested: number, completed: number }} [raw.aiAssistant]
 * @param {{ gpsSilence: number, prolongedStop: number, routeDeviation: number }} [raw.anomalies]
 * @param {{ totalParcels: number, deliveredOnTime: number, delivered: number }} [raw.sla]
 * @returns {object}
 */
export function buildPilotMetrics(raw = {}) {
  const r = raw.referrals ?? {};
  const i = raw.insurance ?? {};
  const k = raw.apiKeys ?? {};
  const w = raw.whatsapp ?? null;
  const a = raw.aiAssistant ?? null;
  const an = raw.anomalies ?? null;
  const s = raw.sla ?? null;

  return {
    referrals: {
      total: safeCount(r.total),
      pending: safeCount(r.pending),
      triggered: safeCount(r.triggered),
      conversionPercent: pct(r.triggered, r.total)
    },
    insurance: {
      active: safeCount(i.active),
      claimed: safeCount(i.claimed),
      cancelled: safeCount(i.cancelled),
      claimRatePercent: pct(i.claimed, (i.active ?? 0) + (i.claimed ?? 0))
    },
    apiKeys: {
      active: safeCount(k.active),
      total: safeCount(k.total)
    },
    whatsapp: w
      ? {
          sent: safeCount(w.sent),
          delivered: safeCount(w.delivered),
          read: safeCount(w.read),
          deliveryRatePercent: pct(w.delivered, w.sent),
          readRatePercent: pct(w.read, w.sent)
        }
      : null,
    aiAssistant: a
      ? {
          requested: safeCount(a.requested),
          completed: safeCount(a.completed),
          successRatePercent: pct(a.completed, a.requested)
        }
      : null,
    anomalies: an
      ? {
          gpsSilence: safeCount(an.gpsSilence),
          prolongedStop: safeCount(an.prolongedStop),
          routeDeviation: safeCount(an.routeDeviation),
          total: safeCount(an.gpsSilence) + safeCount(an.prolongedStop) + safeCount(an.routeDeviation)
        }
      : null,
    sla: s
      ? {
          deliveredOnTime: safeCount(s.deliveredOnTime),
          delivered: safeCount(s.delivered),
          onTimePercent: pct(s.deliveredOnTime, s.delivered)
        }
      : null,
    computedAt: new Date().toISOString()
  };
}
