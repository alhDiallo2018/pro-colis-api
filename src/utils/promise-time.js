/**
 * Promise-time windows — service pur.
 *
 * Propose à l'expéditeur / destinataire 3 créneaux de livraison (matin,
 * après-midi, soir) selon :
 *  - l'heure courante (on ne propose pas un créneau passé),
 *  - la durée estimée du trajet (si > 3 h, matin du jour même exclus),
 *  - une fenêtre horaire configurable (défaut 8-12, 13-17, 18-21).
 *
 * V1 déterministe : aucun ML, aucune consultation de disponibilité
 * chauffeur. Sert à poser une attente côté destinataire et à mettre en
 * place le pattern pour V2 (confirmation destinataire via lien tracking).
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  slots: [
    { id: 'morning', label: 'Matin', startHour: 8, endHour: 12 },
    { id: 'afternoon', label: 'Après-midi', startHour: 13, endHour: 17 },
    { id: 'evening', label: 'Soir', startHour: 18, endHour: 21 }
  ],
  // Combien de jours proposer à l'avance (incluant aujourd'hui si pertinent).
  horizonDays: 3,
  // Buffer min avant qu'un créneau démarre (le chauffeur a besoin de temps).
  minBufferMinutes: 60
});

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function slotStartAt(dayStart, slot) {
  const x = new Date(dayStart);
  x.setHours(slot.startHour, 0, 0, 0);
  return x;
}

function slotEndAt(dayStart, slot) {
  const x = new Date(dayStart);
  x.setHours(slot.endHour, 0, 0, 0);
  return x;
}

/**
 * @param {object} input
 * @param {Date} [input.now]
 * @param {number} [input.estimatedTripHours]  Facultatif. Si fourni et > 3,
 *   le matin du jour même est exclu.
 * @param {object} [input.config]
 * @returns {Array<{id: string, label: string, startAt: string, endAt: string}>}
 */
export function computePromiseSlots({ now = new Date(), estimatedTripHours = null, config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config, slots: config.slots ?? DEFAULTS.slots };
  if (cfg.enabled === false) return [];

  const result = [];
  const bufferMs = cfg.minBufferMinutes * 60 * 1000;
  const today = startOfDay(now);

  for (let d = 0; d < cfg.horizonDays; d++) {
    const day = addDays(today, d);
    for (const slot of cfg.slots) {
      const start = slotStartAt(day, slot);
      const end = slotEndAt(day, slot);
      // Ne jamais proposer un créneau dont le début est déjà passé (minBuffer).
      if (start.getTime() - now.getTime() < bufferMs) continue;
      // Si le trajet dure plus de 3 h et qu'on est aujourd'hui matin, écarter.
      if (
        d === 0 &&
        slot.id === 'morning' &&
        isFiniteNumber(estimatedTripHours) &&
        estimatedTripHours > 3
      ) {
        continue;
      }
      result.push({
        id: `${slot.id}-${day.toISOString().slice(0, 10)}`,
        slotId: slot.id,
        label: slot.label,
        dayOffset: d,
        startAt: start.toISOString(),
        endAt: end.toISOString()
      });
    }
  }

  return result;
}

export const PROMISE_TIME_DEFAULTS = DEFAULTS;
