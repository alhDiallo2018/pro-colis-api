import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { getInvoice, withdrawModeFor, toAccountAlias, verifyCallbackHash } from '../src/utils/paydunya-disburse.js';

/**
 * Cible la cause du 4002 sur l'API PUSH PayDunya :
 *  - le `debit_account_number` (compte marchand à débiter) n'est envoyé que pour
 *    `withdraw_mode: paydunya` ;
 *  - l'erreur 4002 est distinguée entre fonds insuffisants et callback inaccessible.
 */
describe('PayDunya disburse client (API PUSH)', () => {
  const suffix = Date.now().toString().slice(-7);
  const DEBIT_ACCOUNT = `BSN${suffix}`;

  const cfg = [
    ['paydunya.masterKey', `mk-${suffix}`],
    ['paydunya.privateKey', `pk-${suffix}`],
    ['paydunya.token', `tk-${suffix}`],
    ['paydunya.mode', 'test'],
    ['paydunya.debitAccountNumber', DEBIT_ACCOUNT]
  ];

  beforeAll(async () => {
    for (const [key, value] of cfg) {
      await prisma.systemConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      });
    }
  });

  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
    await prisma.$disconnect();
  });

  function mockFetch(status, data) {
    const fn = jest.fn(async () => ({
      status,
      json: async () => data
    }));
    global.fetch = fn;
    return fn;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('envoie debit_account_number pour withdraw_mode paydunya', async () => {
    const fetchMock = mockFetch(200, { response_code: '00', disburse_token: 'tok-1' });

    const res = await getInvoice({
      accountAlias: 'BBJ1000084711',
      amount: 500,
      withdrawMode: 'paydunya',
      callbackUrl: 'https://sendprocolis.com/api/v1/payments/paydunya/disburse-callback'
    });

    expect(res.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.withdraw_mode).toBe('paydunya');
    expect(body.debit_account_number).toBe(DEBIT_ACCOUNT);
    expect(body.account_alias).toBe('BBJ1000084711');
  });

  it("n'envoie pas debit_account_number pour un mode wallet (wave)", async () => {
    const fetchMock = mockFetch(200, { response_code: '00', disburse_token: 'tok-2' });

    await getInvoice({
      accountAlias: '771234567',
      amount: 500,
      withdrawMode: 'wave-senegal',
      callbackUrl: 'https://sendprocolis.com/api/v1/payments/paydunya/disburse-callback'
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.withdraw_mode).toBe('wave-senegal');
    expect(body.debit_account_number).toBeUndefined();
    expect(body.account_alias).toBe('771234567');
  });

  it('distingue un 4002 « callback inaccessible »', async () => {
    mockFetch(200, { response_code: '4002', response_text: 'the callback is not accessible' });

    const res = await getInvoice({
      accountAlias: 'BBJ1000084711',
      amount: 500,
      withdrawMode: 'paydunya',
      callbackUrl: 'https://sendprocolis.com/api/v1/payments/paydunya/disburse-callback'
    });

    expect(res.ok).toBe(false);
    expect(res.error.kind).toBe('CALLBACK_UNREACHABLE');
  });

  it('distingue un 4002 « fonds insuffisants »', async () => {
    mockFetch(200, { response_code: '4002', response_text: "You don't have enough funds. Consider crediting your account" });

    const res = await getInvoice({
      accountAlias: 'BBJ1000084711',
      amount: 500,
      withdrawMode: 'paydunya',
      callbackUrl: 'https://sendprocolis.com/api/v1/payments/paydunya/disburse-callback'
    });

    expect(res.ok).toBe(false);
    expect(res.error.kind).toBe('MERCHANT_INSUFFICIENT_FUNDS');
  });

  it('reste explicite sur un 4002 ambigu', async () => {
    mockFetch(200, { response_code: '4002' });

    const res = await getInvoice({
      accountAlias: 'BBJ1000084711',
      amount: 500,
      withdrawMode: 'paydunya',
      callbackUrl: 'https://sendprocolis.com/api/v1/payments/paydunya/disburse-callback'
    });

    expect(res.ok).toBe(false);
    expect(res.error.kind).toBe('UNKNOWN_PAYDUNYA_ERROR');
  });

  it('mappe les méthodes de retrait vers les withdraw_mode PayDunya', () => {
    expect(withdrawModeFor('wave')).toBe('wave-senegal');
    expect(withdrawModeFor('orange_money')).toBe('orange-money-senegal');
    expect(withdrawModeFor('paydunya')).toBe('paydunya');
    expect(withdrawModeFor('bank')).toBeNull();
  });

  it("retire l'indicatif 221 du numéro bénéficiaire", () => {
    expect(toAccountAlias('+221771234567')).toBe('771234567');
    expect(toAccountAlias('771234567')).toBe('771234567');
  });

  it('le callback charge la Master Key depuis SystemConfig et accepte un hash valide', async () => {
    const masterKey = `mk-${suffix}`;
    const hash = createHash('sha512').update(masterKey).digest('hex');
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .send({ hash, status: 'success', token: 'unknown-token' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('le callback rejette un hash invalide (403 Signature invalide)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .send({ hash: 'forged', status: 'success', token: 'unknown-token' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Signature invalide');
  });
});

describe('verifyCallbackHash (signature du callback PayDunya)', () => {
  const MASTER_KEY = 'master-key-test';

  it('produit le hash SHA-512 attendu pour une Master Key donnée', () => {
    const expected = '5981ff46dbf843cbf7697daad21c650947cc344d51c1b2e48e314990c4643dbfcb86ab3d045393c28565b68cc3420be560724ac5162f1a56c722e9a9ee02e839';
    expect(createHash('sha512').update(MASTER_KEY).digest('hex')).toBe(expected);
    expect(verifyCallbackHash(expected, MASTER_KEY)).toBe(true);
  });

  it('accepte un hash correct avec la bonne Master Key', () => {
    const hash = createHash('sha512').update(MASTER_KEY).digest('hex');
    expect(verifyCallbackHash(hash, MASTER_KEY)).toBe(true);
    expect(verifyCallbackHash(hash.toUpperCase(), MASTER_KEY)).toBe(true);
  });

  it('refuse un hash incorrect', () => {
    expect(verifyCallbackHash('forged-hash', MASTER_KEY)).toBe(false);
  });

  it('refuse une Master Key absente', () => {
    const hash = createHash('sha512').update(MASTER_KEY).digest('hex');
    expect(verifyCallbackHash(hash, '')).toBe(false);
    expect(verifyCallbackHash(hash, undefined)).toBe(false);
    expect(verifyCallbackHash(hash, null)).toBe(false);
  });

  it('refuse un hash absent', () => {
    expect(verifyCallbackHash('', MASTER_KEY)).toBe(false);
    expect(verifyCallbackHash(undefined, MASTER_KEY)).toBe(false);
    expect(verifyCallbackHash(null, MASTER_KEY)).toBe(false);
  });
});
