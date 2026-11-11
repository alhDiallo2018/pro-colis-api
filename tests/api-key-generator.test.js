import { generateApiKey, API_KEY_CONSTANTS } from '../src/utils/api-key-generator.js';

describe('generateApiKey', () => {
  test('retourne un keyId préfixé biz_', () => {
    const { keyId } = generateApiKey();
    expect(keyId.startsWith('biz_')).toBe(true);
    expect(keyId.length).toBe(API_KEY_CONSTANTS.KEY_ID_PREFIX.length + API_KEY_CONSTANTS.KEY_ID_RANDOM_LEN);
  });

  test('retourne un secret long (≥ 40 caractères)', () => {
    const { secret } = generateApiKey();
    expect(secret.length).toBeGreaterThanOrEqual(40);
  });

  test('deux appels produisent des clés distinctes', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.keyId).not.toBe(b.keyId);
    expect(a.secret).not.toBe(b.secret);
  });

  test('keyId évite les caractères ambigus 0/O/I/l/1', () => {
    for (let i = 0; i < 50; i++) {
      const { keyId } = generateApiKey();
      // Partie random uniquement (après préfixe)
      const random = keyId.slice(API_KEY_CONSTANTS.KEY_ID_PREFIX.length);
      expect(random).not.toMatch(/[0OIl1]/);
    }
  });

  test('secret respecte l\'alphabet base64url (sans padding)', () => {
    const { secret } = generateApiKey();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
