import { jest } from '@jest/globals';
import { prisma } from '../src/config/prisma.js';
import { getInvoice, withdrawModeFor, toAccountAlias } from '../src/utils/paydunya-disburse.js';

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
});
