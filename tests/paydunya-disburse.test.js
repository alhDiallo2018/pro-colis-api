import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { getInvoice, submitInvoice, checkStatus, withdrawModeFor, toAccountAlias, verifyCallbackHash } from '../src/utils/paydunya-disburse.js';
import { loadPaydunyaConfig } from '../src/utils/paydunya-config.js';

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
    jest.spyOn(global, 'fetch').mockImplementation(fn);
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

  it.each([
    ['json', {}],
    ['form', '']
  ])('rejette un POST %s vide sans signature ni modification financière', async (contentType, body) => {
    const transactionSpy = jest.spyOn(prisma, '$transaction');
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type(contentType)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Signature invalide');
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it.each([{ data: {} }, { data: '' }, { data: null }, { unexpected: 'probe' }])(
    'rejette un callback sans signature (%j)', async (body) => {
      const res = await request(app)
        .post('/api/v1/payments/paydunya/disburse-callback')
        .send(body);
      expect([400, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    }
  );

  it('accepte les champs du callback API PUSH en form-urlencoded', async () => {
    // API PUSH §1 : champs à plat et hash SHA-512 de la MasterKey.
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send({
        hash: createHash('sha512').update(`mk-${suffix}`).digest('hex'),
        status: 'success', token: 'unknown-token ', withdraw_mode: 'wave-senegal',
        amount: '203.00', updated_at: '11/01/2024 14:30:32',
        disburse_id: 'REF-TEST', transaction_id: 'TX-TEST', disburse_tx_id: 'OP-TEST'
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('accepte un succès wallet sans status, comme dans les exemples API PUSH', async () => {
    mockFetch(200, { response_code: '00', transaction_id: 'TX-TEST', provider_ref: 'OP-TEST' });
    const result = await submitInvoice({ disburseToken: 'token-test' });
    expect(result).toMatchObject({ ok: true, status: 'success', transactionId: 'TX-TEST', providerRef: 'OP-TEST' });
  });

  it('ne transforme pas un statut de soumission inconnu en succès', async () => {
    mockFetch(200, { response_code: '00', status: 'unexpected' });
    expect((await submitInvoice({ disburseToken: 'token-test' })).ok).toBe(false);
  });

  it.each([
    [200, { response_code: '5000', status: 'failed' }],
    [500, { response_code: '00', status: 'failed' }],
    [200, { response_code: '00', status: 'unexpected' }],
    [200, { response_code: '00' }]
  ])('ne confirme pas un statut à partir d’une réponse invalide (%i, %j)', async (httpStatus, body) => {
    mockFetch(httpStatus, body);
    expect((await checkStatus('token-test')).ok).toBe(false);
  });

  it('le callback rejette un hash invalide (403 Signature invalide)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .send({ hash: 'forged', status: 'success', token: 'unknown-token' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Signature invalide');
  });

  it('le callback rejette un hash absent (403 Signature invalide)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .send({ status: 'success', token: 'unknown-token' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Signature invalide');
  });

  it('accepte un hash présent dans data (objet)', async () => {
    const masterKey = `mk-${suffix}`;
    const hash = createHash('sha512').update(masterKey).digest('hex');
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .send({ data: { hash, status: 'success' }, token: 'unknown-token' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('accepte data JSON stringifié avec hash valide (format form-urlencoded PayDunya)', async () => {
    const masterKey = `mk-${suffix}`;
    const hash = createHash('sha512').update(masterKey).digest('hex');
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send({
        data: JSON.stringify({
          hash,
          status: 'success',
          token: 'unknown-token',
          withdraw_mode: 'wave-senegal',
          amount: '500',
          disburse_id: 'DISB-1',
          transaction_id: 'TX-1',
          disburse_tx_id: 'DTX-1',
          updated_at: new Date().toISOString()
        })
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('rejette data JSON stringifié avec hash invalide (403)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send({ data: JSON.stringify({ hash: 'forged', status: 'success', token: 'unknown-token' }) });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Signature invalide');
  });

  it('rejette un data JSON invalide (400)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send({ data: '{not-valid-json' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Données callback PayDunya invalides');
  });

  it('rejette un data qui ne se parse pas en objet (400)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send({ data: '42' });
    expect(res.status).toBe(400);
  });

  // --- Formats réels du callback PayDunya (form-urlencoded, clé `data`) ---
  // Le body brut ci-dessous reproduit EXACTEMENT ce que le middleware reçoit :
  // PayDunya encode le JSON, et le JSON arrive encore percent-encodé (double
  // passe) dans `req.body.data`. C'est le cas qui faisait échouer JSON.parse.

  function rawFormBody(dataValue) {
    return `data=${encodeURIComponent(dataValue)}`;
  }

  it('accepte un data JSON percent-encodé (une passe après le middleware) avec hash valide', async () => {
    const masterKey = `mk-${suffix}`;
    const hash = createHash('sha512').update(masterKey).digest('hex');
    const json = JSON.stringify({
      hash,
      status: 'success',
      token: 'unknown-token',
      withdraw_mode: 'wave-senegal',
      amount: '500',
      updated_at: '11/01/2024 14:30:32'
    });
    // Double-encodage : PayDunya encode le JSON ; superagent n'y touche plus
    // (body string), express décode une fois → `data` reste percent-encodé.
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send(rawFormBody(encodeURIComponent(json)));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('accepte un data JSON double-encodé (deux passes) avec hash valide', async () => {
    const masterKey = `mk-${suffix}`;
    const hash = createHash('sha512').update(masterKey).digest('hex');
    const json = JSON.stringify({ hash, status: 'success', token: 'unknown-token' });
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send(rawFormBody(encodeURIComponent(encodeURIComponent(json))));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('rejette un data JSON percent-encodé avec hash invalide (403)', async () => {
    const json = JSON.stringify({ hash: 'forged', status: 'success', token: 'unknown-token' });
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send(rawFormBody(encodeURIComponent(json)));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Signature invalide');
  });

  it('accepte un data sous forme de query-string form-urlencoded (hash=...&status=...)', async () => {
    const masterKey = `mk-${suffix}`;
    const hash = createHash('sha512').update(masterKey).digest('hex');
    const innerQuery = new URLSearchParams({ hash, status: 'success', token: 'unknown-token' }).toString();
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send(`data=${encodeURIComponent(innerQuery)}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('rejette un data absent de data malformé (400)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send('data=%E0%A4%A');
    expect(res.status).toBe(400);
  });

  it('le callback traite un body encodé en form-urlencoded (Content-Type PayDunya)', async () => {
    const masterKey = `mk-${suffix}`;
    const hash = createHash('sha512').update(masterKey).digest('hex');
    const res = await request(app)
      .post('/api/v1/payments/paydunya/disburse-callback')
      .type('form')
      .send({ hash, status: 'success', token: 'unknown-token' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction inconnue');
  });

  it('loadPaydunyaConfig(true) charge la config actuelle depuis SystemConfig', async () => {
    const cfg = await loadPaydunyaConfig(true);
    expect(cfg.masterKey).toBe(`mk-${suffix}`);
    expect(cfg.mode).toBe('test');
  });
});

describe('PayDunya disburse callback — statut success/failed', () => {
  const suffix = Date.now().toString().slice(-7);
  const MASTER_KEY = `cb-mk-${suffix}`;
  const phone = `76${suffix}`;
  const DISBURSE_TOKEN = `CB-TOKEN-${suffix}`;
  let userId;
  let withdrawalId;

  const validHash = createHash('sha512').update(MASTER_KEY).digest('hex');

  function callback({ data, type = 'json' } = {}) {
    const req = request(app).post('/api/v1/payments/paydunya/disburse-callback');
    return type === 'form' ? req.type('form').send({ data }) : req.send(data);
  }

  beforeAll(async () => {
    for (const [key, value] of [
      ['paydunya.masterKey', MASTER_KEY],
      ['paydunya.privateKey', `cb-pk-${suffix}`],
      ['paydunya.token', `cb-tk-${suffix}`],
      ['paydunya.mode', 'test']
    ]) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    const user = await prisma.user.create({ data: { phone, fullName: 'Driver CB', role: 'driver' } });
    userId = user.id;
    await prisma.wallet.create({ data: { userId, balance: 5000, pendingBalance: 2000, totalDeposited: 5000 } });
    const withdrawal = await prisma.withdrawal.create({
      data: {
        walletUserId: userId,
        amount: 2000,
        method: 'wave',
        phone,
        status: 'processing',
        reference: `REF-${suffix}`,
        disburseToken: DISBURSE_TOKEN
      }
    });
    withdrawalId = withdrawal.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.withdrawal.deleteMany({ where: { walletUserId: userId } });
      await prisma.walletTransaction.deleteMany({ where: { walletUserId: userId } });
      await prisma.wallet.deleteMany({ where: { userId: userId } });
      await prisma.notification.deleteMany({ where: { userId: userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
    await prisma.$disconnect();
  });

  it('statut success → finalise le retrait (form-urlencoded, data JSON stringifié)', async () => {
    const res = await callback({
      type: 'form',
      data: JSON.stringify({
        hash: validHash,
        status: 'success',
        token: DISBURSE_TOKEN,
        transaction_id: 'TX-SUCCESS',
        disburse_tx_id: 'DTX-SUCCESS'
      })
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Callback traité');

    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    expect(withdrawal.status).toBe('completed');
    expect(withdrawal.transactionId).toBe('TX-SUCCESS');
    expect(withdrawal.providerRef).toBe('DTX-SUCCESS');

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet.pendingBalance)).toBe(0);
    expect(Number(wallet.totalWithdrawn)).toBe(2000);
  });

  it('statut failed → échoue le retrait et recrédite le solde gelé', async () => {
    const failedWithdrawal = await prisma.withdrawal.create({
      data: {
        walletUserId: userId,
        amount: 1500,
        method: 'wave',
        phone,
        status: 'processing',
        reference: `REF-FAIL-${suffix}`,
        disburseToken: `CB-TOKEN-FAIL-${suffix}`
      }
    });
    const walletBefore = await prisma.wallet.findUnique({ where: { userId } });

    const res = await callback({
      type: 'form',
      data: JSON.stringify({
        hash: validHash,
        status: 'failed',
        token: `CB-TOKEN-FAIL-${suffix}`
      })
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Callback traité');

    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: failedWithdrawal.id } });
    expect(withdrawal.status).toBe('failed');
    expect(withdrawal.failureReason).toBeTruthy();

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet.pendingBalance)).toBe(Number(walletBefore.pendingBalance) - 1500);
    expect(Number(wallet.balance)).toBe(Number(walletBefore.balance) + 1500);
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

  it('refuse un hash entouré d’espaces (comparaison stricte, sans affaiblir la sécurité)', () => {
    const hash = createHash('sha512').update(MASTER_KEY).digest('hex');
    expect(verifyCallbackHash(`  ${hash}  `, MASTER_KEY)).toBe(false);
    expect(verifyCallbackHash(` ${hash}`, MASTER_KEY)).toBe(false);
    expect(verifyCallbackHash(`${hash} `, MASTER_KEY)).toBe(false);
  });
});
