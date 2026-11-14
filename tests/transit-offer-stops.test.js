import { validateOfferStops } from '../src/utils/transit-offer-stops.js';
import { ValidationError } from '../src/utils/errors.js';

const lineStops = [
  { order: 0 }, { order: 1 }, { order: 2 }, { order: 3 }, { order: 4 }
];

describe('validateOfferStops', () => {
  test('annonce sans transit_line_id, sans stops : OK', () => {
    const result = validateOfferStops({ transitLineId: null }, {}, { transitLineStops: [] });
    expect(result).toEqual({ boardingStopOrder: null, dropOffStopOrder: null });
  });

  test('annonce sans transit_line_id mais stops fournis : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: null },
      { boardingStopOrder: 0, dropOffStopOrder: 1 },
      { transitLineStops: [] }
    )).toThrow(ValidationError);
  });

  test('annonce avec ligne, stops valides et ordre croissant : OK', () => {
    const result = validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: 1, dropOffStopOrder: 3 },
      { transitLineStops: lineStops }
    );
    expect(result).toEqual({ boardingStopOrder: 1, dropOffStopOrder: 3 });
  });

  test('annonce avec ligne, sans stops et sans itinéraire : OK (compat legacy)', () => {
    const result = validateOfferStops(
      { transitLineId: 'line-uuid', metadata: {} },
      {},
      { transitLineStops: lineStops }
    );
    expect(result).toEqual({ boardingStopOrder: null, dropOffStopOrder: null });
  });

  test('annonce avec itinéraire mais stops manquants : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: 'line-uuid', metadata: { itinerary: { stops: [] } } },
      {},
      { transitLineStops: lineStops }
    )).toThrow(ValidationError);
  });

  test('boarding inconnu : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: 42, dropOffStopOrder: 2 },
      { transitLineStops: lineStops }
    )).toThrow(ValidationError);
  });

  test('dropOff inconnu : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: 0, dropOffStopOrder: 42 },
      { transitLineStops: lineStops }
    )).toThrow(ValidationError);
  });

  test('ordre inversé (boarding >= dropOff) : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: 3, dropOffStopOrder: 1 },
      { transitLineStops: lineStops }
    )).toThrow(ValidationError);
  });

  test('ordre identique (boarding = dropOff) : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: 2, dropOffStopOrder: 2 },
      { transitLineStops: lineStops }
    )).toThrow(ValidationError);
  });

  test('un seul stop fourni : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: 1 },
      { transitLineStops: lineStops }
    )).toThrow(ValidationError);
  });

  test('stop en string numérique : accepté', () => {
    const result = validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: '1', dropOffStopOrder: '3' },
      { transitLineStops: lineStops }
    );
    expect(result).toEqual({ boardingStopOrder: 1, dropOffStopOrder: 3 });
  });

  test('stop négatif : rejet 422', () => {
    expect(() => validateOfferStops(
      { transitLineId: 'line-uuid' },
      { boardingStopOrder: -1, dropOffStopOrder: 2 },
      { transitLineStops: lineStops }
    )).toThrow(ValidationError);
  });
});
