import { isCommissionDebtLimitReached } from '../src/utils/commission.js';
import { isClientDebtLimitReached } from '../src/utils/client-debt.js';

describe('seuil de dette chauffeur', () => {
  test('ne bloque pas sous le seuil', () => {
    expect(isCommissionDebtLimitReached(499, 500)).toBe(false);
  });

  test('bloque exactement au seuil et au-dessus', () => {
    expect(isCommissionDebtLimitReached(500, 500)).toBe(true);
    expect(isCommissionDebtLimitReached(750, 500)).toBe(true);
  });

  test('un seuil nul désactive le blocage', () => {
    expect(isCommissionDebtLimitReached(100000, 0)).toBe(false);
  });
});

describe('seuil de dette client', () => {
  test('bloque la création exactement au seuil', () => {
    expect(isClientDebtLimitReached(999, 1000)).toBe(false);
    expect(isClientDebtLimitReached(1000, 1000)).toBe(true);
  });

  test('un seuil nul désactive le blocage', () => {
    expect(isClientDebtLimitReached(5000, 0)).toBe(false);
  });
});
