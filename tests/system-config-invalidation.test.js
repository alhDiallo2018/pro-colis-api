// Teste le dispatcher d'invalidation (`invalidateByKey` / `invalidateByKeys`).
//
// Chaque appel d'invalidation (`invalidateTimingsCache`, …) est mocké pour
// vérifier qu'`invalidateByKey('timings.foo')` appelle uniquement le bon
// cache et que `invalidateByKeys([...])` déduplique par groupe.
import { jest } from '@jest/globals';

const timings = jest.fn();
const limits = jest.fn();
const branding = jest.fn();
const auth = jest.fn();
const paydunya = jest.fn();
const anomaly = jest.fn();
const fraud = jest.fn();
const driverScoring = jest.fn();
const eta = jest.fn();
const consolidation = jest.fn();
const aiAssistant = jest.fn();
const brevo = jest.fn();

jest.unstable_mockModule('../src/utils/timings-config.js', () => ({
  invalidateTimingsCache: timings
}));
jest.unstable_mockModule('../src/utils/limits-config.js', () => ({
  invalidateLimitsCache: limits
}));
jest.unstable_mockModule('../src/utils/branding-config.js', () => ({
  invalidateBrandingCache: branding
}));
jest.unstable_mockModule('../src/utils/auth-config.js', () => ({
  invalidateAuthConfigCache: auth
}));
jest.unstable_mockModule('../src/utils/paydunya-config.js', () => ({
  invalidatePaydunyaConfigCache: paydunya
}));
jest.unstable_mockModule('../src/utils/anomaly-config.js', () => ({
  invalidateAnomalyConfigCache: anomaly
}));
jest.unstable_mockModule('../src/utils/fraud-config.js', () => ({
  invalidateFraudConfigCache: fraud
}));
jest.unstable_mockModule('../src/utils/driver-scoring-config.js', () => ({
  invalidateDriverScoringCache: driverScoring
}));
jest.unstable_mockModule('../src/utils/eta-config.js', () => ({
  invalidateEtaConfigCache: eta
}));
jest.unstable_mockModule('../src/utils/consolidation-config.js', () => ({
  invalidateConsolidationConfigCache: consolidation
}));
jest.unstable_mockModule('../src/utils/ai-assistant-config.js', () => ({
  invalidateAiAssistantConfigCache: aiAssistant
}));
jest.unstable_mockModule('../src/utils/brevo.js', () => ({
  invalidateBrevoConfigCache: brevo
}));

const { invalidateByKey, invalidateByKeys, groupForKey } = await import(
  '../src/utils/system-config-invalidation.js'
);

beforeEach(() => {
  timings.mockReset();
  limits.mockReset();
  branding.mockReset();
  auth.mockReset();
  paydunya.mockReset();
  anomaly.mockReset();
  fraud.mockReset();
  driverScoring.mockReset();
  eta.mockReset();
  consolidation.mockReset();
  aiAssistant.mockReset();
  brevo.mockReset();
});

describe('groupForKey', () => {
  test('mappe les préfixes connus', () => {
    expect(groupForKey('timings.foo')).toBe('timings');
    expect(groupForKey('limits.csvMaxLines')).toBe('limits');
    expect(groupForKey('branding.themeColor')).toBe('branding');
    // `notifications.*` partage le cache `branding` (même reader).
    expect(groupForKey('notifications.fallbackTitle')).toBe('branding');
    expect(groupForKey('auth.otpExpiryMinutes')).toBe('auth');
    expect(groupForKey('paydunya.mode')).toBe('paydunya');
  });

  test('retourne null pour une clé sans cache dédié', () => {
    // Pas de cache mémoire sur ces readers (commission/support/legal/help…)
    expect(groupForKey('commission.debtLimit')).toBeNull();
    expect(groupForKey('support.phone')).toBeNull();
    expect(groupForKey('legal.companyName')).toBeNull();
    expect(groupForKey('insufficientPolicy')).toBeNull();
  });

  test('tolère les entrées invalides', () => {
    expect(groupForKey(null)).toBeNull();
    expect(groupForKey(undefined)).toBeNull();
    expect(groupForKey(42)).toBeNull();
    expect(groupForKey('')).toBeNull();
  });
});

describe('invalidateByKey', () => {
  test('timings.foo → invalidateTimingsCache', () => {
    const ok = invalidateByKey('timings.foo');
    expect(ok).toBe(true);
    expect(timings).toHaveBeenCalledTimes(1);
    expect(limits).not.toHaveBeenCalled();
    expect(branding).not.toHaveBeenCalled();
  });

  test('limits.csvMaxLines → invalidateLimitsCache', () => {
    invalidateByKey('limits.csvMaxLines');
    expect(limits).toHaveBeenCalledTimes(1);
    expect(timings).not.toHaveBeenCalled();
  });

  test('notifications.* → invalidateBrandingCache (partagé)', () => {
    invalidateByKey('notifications.fallbackTitle');
    expect(branding).toHaveBeenCalledTimes(1);
  });

  test('clé sans cache dédié → no-op, pas d\'appel', () => {
    const ok = invalidateByKey('commission.debtLimit');
    expect(ok).toBe(false);
    expect(timings).not.toHaveBeenCalled();
    expect(limits).not.toHaveBeenCalled();
    expect(branding).not.toHaveBeenCalled();
  });

  test('tolère une erreur d\'invalidation sans crasher', () => {
    timings.mockImplementation(() => {
      throw new Error('cache inaccessible');
    });
    const ok = invalidateByKey('timings.foo');
    expect(ok).toBe(false);
  });
});

describe('invalidateByKeys', () => {
  test('déduplique par groupe (10 clés timings.* → 1 seul invalidate)', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `timings.k${i}`);
    const groups = invalidateByKeys(keys);
    expect(timings).toHaveBeenCalledTimes(1);
    expect(groups).toEqual(['timings']);
  });

  test('plusieurs groupes → un appel par groupe', () => {
    const groups = invalidateByKeys([
      'timings.a',
      'timings.b',
      'limits.c',
      'branding.d',
      'notifications.e' // même groupe que branding → pas de doublon
    ]);
    expect(timings).toHaveBeenCalledTimes(1);
    expect(limits).toHaveBeenCalledTimes(1);
    expect(branding).toHaveBeenCalledTimes(1);
    expect(new Set(groups)).toEqual(new Set(['timings', 'limits', 'branding']));
  });

  test('ignore les clés sans cache dédié', () => {
    const groups = invalidateByKeys(['commission.debtLimit', 'support.phone', 'timings.a']);
    expect(timings).toHaveBeenCalledTimes(1);
    expect(groups).toEqual(['timings']);
  });

  test('entrée invalide → liste vide', () => {
    expect(invalidateByKeys(null)).toEqual([]);
    expect(invalidateByKeys(undefined)).toEqual([]);
    expect(invalidateByKeys('timings.foo')).toEqual([]);
  });
});
