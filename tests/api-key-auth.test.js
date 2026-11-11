import { hashApiSecret, parseApiKey, validateApiKey } from '../src/utils/api-key-auth.js';

describe('parseApiKey', () => {
  test('parse un header keyId.secret valide', () => {
    const r = parseApiKey('biz_abc123.supersecretvalue1234');
    expect(r).toEqual({ keyId: 'biz_abc123', secret: 'supersecretvalue1234' });
  });

  test('refuse un format sans point', () => {
    expect(parseApiKey('nodothere')).toBeNull();
  });

  test('refuse un secret trop court (< 16 car)', () => {
    expect(parseApiKey('biz_abc.short')).toBeNull();
  });

  test('refuse un keyId avec caractères invalides', () => {
    expect(parseApiKey('biz abc.supersecretvalue1234')).toBeNull();
  });

  test('refuse undefined/null', () => {
    expect(parseApiKey(undefined)).toBeNull();
    expect(parseApiKey(null)).toBeNull();
  });
});

describe('validateApiKey', () => {
  const secret = 'supersecretvalue1234';
  const record = {
    keyHash: hashApiSecret(secret),
    scopes: ['shipments.read', 'shipments.write'],
    partnerName: 'Boutique X'
  };

  test('valide un secret correct', () => {
    expect(validateApiKey(record, secret)).toBe(true);
  });

  test('rejette un secret incorrect', () => {
    expect(validateApiKey(record, 'wrong-secret-value')).toBe(false);
  });

  test('vérifie le scope requis', () => {
    expect(validateApiKey(record, secret, 'shipments.read')).toBe(true);
    expect(validateApiKey(record, secret, 'shipments.delete')).toBe(false);
  });

  test('rejette un record sans keyHash', () => {
    expect(validateApiKey({}, secret)).toBe(false);
    expect(validateApiKey(null, secret)).toBe(false);
  });
});

describe('hashApiSecret', () => {
  test('retourne un hash SHA-256 hex stable', () => {
    const h1 = hashApiSecret('secret1234567890');
    const h2 = hashApiSecret('secret1234567890');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashes différents pour secrets différents', () => {
    expect(hashApiSecret('secret1234567890')).not.toBe(hashApiSecret('secret1234567891'));
  });
});
