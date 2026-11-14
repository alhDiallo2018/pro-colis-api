import { generatePickupPin, generatePickupQrToken, hashProof, proofMatches } from '../src/utils/handover-proofs.js';

describe('handover-proofs', () => {
  test('generatePickupPin : 6 chiffres', () => {
    for (let i = 0; i < 20; i++) {
      const pin = generatePickupPin();
      expect(pin).toMatch(/^\d{6}$/);
    }
  });

  test('generatePickupQrToken : base64url de longueur suffisante', () => {
    const token = generatePickupQrToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 24 octets en base64url => 32 caractères.
    expect(token.length).toBeGreaterThanOrEqual(30);
  });

  test('hashProof : SHA-256 hex stable', () => {
    const h1 = hashProof('123456');
    const h2 = hashProof('123456');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(h1).not.toBe(hashProof('654321'));
  });

  test('proofMatches : succès + échec', () => {
    const hash = hashProof('secret-pin');
    expect(proofMatches('secret-pin', hash)).toBe(true);
    expect(proofMatches('secret-pi', hash)).toBe(false);
    expect(proofMatches('secret-pin ', hash)).toBe(false);
    expect(proofMatches('', hash)).toBe(false);
    expect(proofMatches(null, hash)).toBe(false);
  });

  test('proofMatches : hash vide → false', () => {
    expect(proofMatches('anything', '')).toBe(false);
    expect(proofMatches('anything', null)).toBe(false);
  });
});
