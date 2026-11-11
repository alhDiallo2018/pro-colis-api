import { computePromiseSlots, PROMISE_TIME_DEFAULTS } from '../src/utils/promise-time.js';

function at(iso) {
  return new Date(iso);
}

describe('computePromiseSlots — proposition 3 jours', () => {
  test('propose ~3 créneaux par jour sur 3 jours quand il est tôt le matin', () => {
    const now = at('2026-11-11T05:00:00+00:00');
    const slots = computePromiseSlots({ now });
    // 3 slots × 3 jours = 9 — tous les slots d'aujourd'hui sont encore dans le futur.
    expect(slots.length).toBe(9);
  });

  test('exclut les créneaux passés', () => {
    const now = at('2026-11-11T14:00:00+00:00'); // 14h, matin et début d'après-midi passés
    const slots = computePromiseSlots({ now });
    // Matin et après-midi d'aujourd'hui exclus → 1 + 3 + 3 = 7
    expect(slots.filter((s) => s.dayOffset === 0).length).toBe(1);
    expect(slots.filter((s) => s.dayOffset === 0)[0].slotId).toBe('evening');
  });

  test('respecte le buffer minimum avant le début', () => {
    const now = at('2026-11-11T07:30:00+00:00'); // 30 min avant matin
    const slots = computePromiseSlots({ now });
    // Avec buffer 60 min, le créneau 8h-12h d'aujourd'hui doit être exclu.
    const todayMorning = slots.find((s) => s.dayOffset === 0 && s.slotId === 'morning');
    expect(todayMorning).toBeUndefined();
  });
});

describe('computePromiseSlots — trajet long exclut le matin aujourd\'hui', () => {
  test('estimatedTripHours > 3 et matin aujourd\'hui → exclu', () => {
    const now = at('2026-11-11T05:00:00+00:00');
    const slots = computePromiseSlots({ now, estimatedTripHours: 5 });
    const todayMorning = slots.find((s) => s.dayOffset === 0 && s.slotId === 'morning');
    expect(todayMorning).toBeUndefined();
  });

  test('estimatedTripHours < 3 → matin aujourd\'hui conservé', () => {
    const now = at('2026-11-11T05:00:00+00:00');
    const slots = computePromiseSlots({ now, estimatedTripHours: 2 });
    const todayMorning = slots.find((s) => s.dayOffset === 0 && s.slotId === 'morning');
    expect(todayMorning).toBeTruthy();
  });

  test('le matin des jours suivants reste proposé', () => {
    const now = at('2026-11-11T05:00:00+00:00');
    const slots = computePromiseSlots({ now, estimatedTripHours: 10 });
    const tomorrowMorning = slots.find((s) => s.dayOffset === 1 && s.slotId === 'morning');
    expect(tomorrowMorning).toBeTruthy();
  });
});

describe('computePromiseSlots — tolérance', () => {
  test('flag enabled=false retourne []', () => {
    const now = at('2026-11-11T05:00:00+00:00');
    expect(computePromiseSlots({ now, config: { enabled: false } })).toEqual([]);
  });

  test('horizonDays override', () => {
    const now = at('2026-11-11T05:00:00+00:00');
    const slots = computePromiseSlots({ now, config: { horizonDays: 1 } });
    expect(slots.every((s) => s.dayOffset === 0)).toBe(true);
  });

  test('IDs uniques pour chaque slot', () => {
    const now = at('2026-11-11T05:00:00+00:00');
    const slots = computePromiseSlots({ now });
    const ids = slots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('PROMISE_TIME_DEFAULTS', () => {
  test('3 slots par défaut', () => {
    expect(PROMISE_TIME_DEFAULTS.slots).toHaveLength(3);
  });

  test('horizonDays à 3 jours', () => {
    expect(PROMISE_TIME_DEFAULTS.horizonDays).toBe(3);
  });
});
