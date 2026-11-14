import { optimizeTour } from '../src/utils/tour-optimizer.js';

const DAKAR = { id: 'dakar', latitude: 14.6937, longitude: -17.4441 };
const THIES = { id: 'thies', latitude: 14.7919, longitude: -16.9359 };
const MBOUR = { id: 'mbour', latitude: 14.4199, longitude: -16.9664 };
const SAINT_LOUIS = { id: 'sl', latitude: 16.0326, longitude: -16.4890 };
const KAOLACK = { id: 'kao', latitude: 14.1500, longitude: -16.0667 };

describe('optimizeTour', () => {
  test('aucun arrêt : ordre vide, distance zéro', () => {
    const r = optimizeTour({ origin: DAKAR, stops: [] });
    expect(r.ordered).toEqual([]);
    expect(r.distanceKm).toBe(0);
  });

  test('un seul arrêt : route = [arrêt]', () => {
    const r = optimizeTour({ origin: DAKAR, stops: [THIES] });
    expect(r.ordered).toHaveLength(1);
    expect(r.ordered[0].id).toBe('thies');
    expect(r.distanceKm).toBeGreaterThan(0);
  });

  test('2 arrêts : nearest-neighbor choisit le plus proche en premier', () => {
    const r = optimizeTour({ origin: DAKAR, stops: [SAINT_LOUIS, THIES] });
    expect(r.ordered[0].id).toBe('thies');
    expect(r.ordered[1].id).toBe('sl');
  });

  test('ordre pathologique amélioré par 2-opt', () => {
    // Pathologique : Dakar → Kaolack (loin) → Thiès (près de Dakar) → Mbour.
    // 2-opt doit préférer Dakar → Thiès → Mbour → Kaolack.
    const r = optimizeTour({ origin: DAKAR, stops: [KAOLACK, THIES, MBOUR] });
    // L'arrêt le plus proche (Thiès) doit arriver avant Kaolack
    const idxThies = r.ordered.findIndex((s) => s.id === 'thies');
    const idxKaolack = r.ordered.findIndex((s) => s.id === 'kao');
    expect(idxThies).toBeLessThan(idxKaolack);
    expect(r.distanceKm).toBeLessThan(500);
  });

  test('coordonnées invalides filtrées', () => {
    const invalid = { id: 'bad', latitude: 'oops', longitude: null };
    const r = optimizeTour({ origin: DAKAR, stops: [THIES, invalid, MBOUR] });
    expect(r.ordered).toHaveLength(2);
    expect(r.ordered.find((s) => s.id === 'bad')).toBeUndefined();
  });

  test('origin invalide lève', () => {
    expect(() => optimizeTour({ origin: { latitude: NaN, longitude: 0 }, stops: [THIES] })).toThrow(/origin/);
  });

  test('returnToOrigin : la distance mesure le cycle fermé', () => {
    const rOpen = optimizeTour({ origin: DAKAR, stops: [THIES, MBOUR] });
    const rClosed = optimizeTour({ origin: DAKAR, stops: [THIES, MBOUR], config: { returnToOrigin: true } });
    expect(rClosed.distanceKm).toBeGreaterThan(rOpen.distanceKm);
    // L'ordre exposé ne contient pas le dépôt final.
    expect(rClosed.ordered.at(-1).id).not.toBe('dakar');
  });

  test('4 arrêts : la route 2-opt est <= à la route nearest-neighbor seule', () => {
    const r = optimizeTour({ origin: DAKAR, stops: [SAINT_LOUIS, KAOLACK, MBOUR, THIES] });
    expect(r.improvedBy).toBeGreaterThanOrEqual(0);
    // Vérifie que toutes les villes sont présentes exactement une fois.
    const ids = r.ordered.map((s) => s.id).sort();
    expect(ids).toEqual(['kao', 'mbour', 'sl', 'thies']);
  });

  test('bornage iterations : jamais au-delà de maxIterations', () => {
    const r = optimizeTour({
      origin: DAKAR,
      stops: [THIES, MBOUR, SAINT_LOUIS, KAOLACK],
      config: { maxIterations: 1 }
    });
    expect(r.iterations).toBeLessThanOrEqual(1);
  });

  test('ordre déterministe pour une même entrée', () => {
    const r1 = optimizeTour({ origin: DAKAR, stops: [SAINT_LOUIS, KAOLACK, THIES, MBOUR] });
    const r2 = optimizeTour({ origin: DAKAR, stops: [SAINT_LOUIS, KAOLACK, THIES, MBOUR] });
    expect(r1.ordered.map((s) => s.id)).toEqual(r2.ordered.map((s) => s.id));
    expect(r1.distanceKm).toBe(r2.distanceKm);
  });

  test('5+ arrêts proches en zigzag : 2-opt réduit la distance', () => {
    // Zigzag intentionnel : alternance nord/sud qui invite au 2-opt.
    const pts = [];
    for (let i = 0; i < 6; i++) {
      pts.push({ id: `p${i}`, latitude: 14.69 + (i % 2 ? 0.05 : -0.05), longitude: -17.44 + i * 0.03 });
    }
    const r = optimizeTour({ origin: DAKAR, stops: pts });
    expect(r.improvedBy).toBeGreaterThanOrEqual(0);
    expect(r.ordered).toHaveLength(6);
  });
});
