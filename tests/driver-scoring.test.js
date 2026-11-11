import { scoreBids, rankBids, DRIVER_SCORING_DEFAULTS } from '../src/utils/driver-scoring.js';

/**
 * Tests unitaires du moteur de recommandation chauffeur.
 * Pure function — zero DB, zero network.
 */

const SAMPLE_BIDS = [
  {
    id: 'A',
    price: 5000,
    driverRating: 4.8,
    distanceKm: 3,
    onTimeRatio: 0.95,
    acceptsParcelType: true
  },
  {
    id: 'B',
    price: 7000,
    driverRating: 4.2,
    distanceKm: 8,
    onTimeRatio: 0.85,
    acceptsParcelType: true
  },
  {
    id: 'C',
    price: 4500,
    driverRating: 2.0,
    distanceKm: 20,
    onTimeRatio: 0.60,
    acceptsParcelType: false
  }
];

describe('scoreBids', () => {
  test('retourne un tableau vide pour une liste vide', () => {
    expect(scoreBids([])).toEqual([]);
  });

  test('assigne un score 0..100 à chaque bid', () => {
    const scored = scoreBids(SAMPLE_BIDS);
    expect(scored).toHaveLength(3);
    for (const bid of scored) {
      expect(bid.score).toBeGreaterThanOrEqual(0);
      expect(bid.score).toBeLessThanOrEqual(100);
      expect(bid.breakdown).toBeTruthy();
    }
  });

  test("la meilleure offre (prix bas + note haute + proche) domine", () => {
    const scored = scoreBids(SAMPLE_BIDS);
    const ranked = [...scored].sort((a, b) => b.score - a.score);
    expect(ranked[0].id).toBe('A');
  });

  test('bid avec note < minAcceptableRating reçoit une pénalité', () => {
    const scored = scoreBids(SAMPLE_BIDS);
    const bidC = scored.find((b) => b.id === 'C');
    expect(bidC.breakdown.ratingPenalty).toBe(0.6);
  });

  test('retombe sur 0.5 pour les critères manquants (neutralité)', () => {
    const scored = scoreBids([
      { id: 'X', price: 5000 } // pas de rating, distance, onTime, type
    ]);
    const bidX = scored[0];
    expect(bidX.breakdown.rating).toBe(0.5);
    expect(bidX.breakdown.distance).toBe(0.5);
    expect(bidX.breakdown.punctuality).toBe(0.5);
    expect(bidX.breakdown.typeMatch).toBe(0.5);
  });

  test('toutes les offres au même prix obtiennent price=1', () => {
    const scored = scoreBids([
      { id: '1', price: 5000, driverRating: 4, distanceKm: 5, onTimeRatio: 0.9, acceptsParcelType: true },
      { id: '2', price: 5000, driverRating: 4, distanceKm: 5, onTimeRatio: 0.9, acceptsParcelType: true }
    ]);
    expect(scored[0].breakdown.price).toBe(1);
    expect(scored[1].breakdown.price).toBe(1);
  });

  test('respect du flag enabled=false : scores null', () => {
    const scored = scoreBids(SAMPLE_BIDS, { config: { enabled: false } });
    for (const bid of scored) {
      expect(bid.score).toBeNull();
      expect(bid.breakdown).toBeNull();
    }
  });

  test('override des poids influence le classement', () => {
    // Si on met tout le poids sur le prix, la bid C (prix le plus bas) gagne
    // malgré sa mauvaise note.
    const scored = scoreBids(SAMPLE_BIDS, {
      config: {
        weightPrice: 1,
        weightRating: 0,
        weightDistance: 0,
        weightPunctuality: 0,
        weightTypeMatch: 0,
        minAcceptableRating: 0 // pas de pénalité
      }
    });
    const ranked = [...scored].sort((a, b) => b.score - a.score);
    expect(ranked[0].id).toBe('C');
  });

  test('distance au-delà de maxDistanceKm → score distance 0', () => {
    const scored = scoreBids([
      { id: 'far', price: 5000, driverRating: 4, distanceKm: 100, onTimeRatio: 0.9, acceptsParcelType: true }
    ], {
      config: { maxDistanceKm: 50 }
    });
    expect(scored[0].breakdown.distance).toBe(0);
  });
});

describe('rankBids', () => {
  test('retourne les bids triés par score décroissant', () => {
    const ranked = rankBids(SAMPLE_BIDS);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  test('bid avec acceptsParcelType=true devance un bid équivalent avec false', () => {
    const ranked = rankBids([
      { id: 'yes', price: 5000, driverRating: 4, distanceKm: 5, onTimeRatio: 0.9, acceptsParcelType: true },
      { id: 'no',  price: 5000, driverRating: 4, distanceKm: 5, onTimeRatio: 0.9, acceptsParcelType: false }
    ]);
    expect(ranked[0].id).toBe('yes');
  });
});

describe('DRIVER_SCORING_DEFAULTS', () => {
  test('les poids somment à 1', () => {
    const d = DRIVER_SCORING_DEFAULTS;
    const sum = d.weightPrice + d.weightRating + d.weightDistance + d.weightPunctuality + d.weightTypeMatch;
    expect(sum).toBeCloseTo(1, 2);
  });
});
