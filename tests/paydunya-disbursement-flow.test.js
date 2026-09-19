import { jest } from '@jest/globals';
import { prisma } from '../src/config/prisma.js';
import { loadPaydunyaConfig, invalidatePaydunyaConfigCache } from '../src/utils/paydunya-config.js';
import { attemptDisbursement } from '../src/utils/withdrawal-flow.js';

// API PUSH §4 : vérifier les effets financiers réels avec une base de test,
// tout en simulant exclusivement les réponses HTTP du prestataire.
describe('reprise du déboursement selon la documentation API PUSH', () => {
  const suffix = Date.now().toString();
  let userId;
  let withdrawal;
  let fetchMock;
  const log = { warn: jest.fn(), error: jest.fn() };
  const response = (data) => ({ status: 200, json: async () => data });
  const statusResponse = (status) => response({ response_code: '00', status });
  const rejected = () => response({ response_code: '5000', response_text: 'An error occured from our side. Please retry later.' });

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { phone: `77${suffix.slice(-7)}`, fullName: 'PUSH flow test', role: 'driver' } });
    userId = user.id;
    for (const [key, value] of Object.entries({ masterKey: 'flow-master', privateKey: 'flow-private', token: 'flow-token' })) {
      await prisma.systemConfig.upsert({ where: { key: `paydunya.${key}` }, update: { value }, create: { key: `paydunya.${key}`, value } });
    }
    await loadPaydunyaConfig(true);
  });

  beforeEach(async () => {
    // Chaque cas part d'un retrait de 2 000 déjà gelé sur un solde de 5 000.
    await prisma.withdrawal.deleteMany({ where: { walletUserId: userId } });
    await prisma.walletTransaction.deleteMany({ where: { walletUserId: userId } });
    const balances = { balance: 3000, pendingBalance: 2000, totalSpent: 0, totalWithdrawn: 0 };
    await prisma.wallet.upsert({ where: { userId }, update: balances, create: { userId, ...balances } });
    withdrawal = await prisma.withdrawal.create({ data: {
      walletUserId: userId, amount: 2000, method: 'wave', phone: '771234567',
      status: 'processing', reference: `FLOW-${suffix}`, disburseToken: `TOKEN-${suffix}`
    } });
    fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected provider request'));
    jest.clearAllMocks();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (userId) {
      await prisma.withdrawal.deleteMany({ where: { walletUserId: userId } });
      await prisma.walletTransaction.deleteMany({ where: { walletUserId: userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
    invalidatePaydunyaConfigCache();
    await prisma.$disconnect();
  });

  async function expectBalances(balance, pendingBalance) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet.balance)).toBe(balance);
    expect(Number(wallet.pendingBalance)).toBe(pendingBalance);
  }

  it('refus get-invoice 4002 callback : recrédite sans soumettre de versement', async () => {
    await prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { disburseToken: null } });
    fetchMock.mockResolvedValueOnce(response({ response_code: ['4002'], response_text: 'the callback is not accessible' }));
    const result = await attemptDisbursement(withdrawal.id, log);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('callback_url');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/get-invoice$/);
    await expectBalances(5000, 0);
  });

  it('CREATED : resoumet le même token, sans recréer d’invoice', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(statusResponse('success'));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('completed');
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname.split('/').pop())).toEqual(['check-status', 'submit-invoice']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ disburse_invoice: withdrawal.disburseToken, disburse_id: withdrawal.reference });
    await expectBalances(3000, 0);
  });

  it('persiste le nouveau token avant Submit et le réutilise pour check-status', async () => {
    await prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { disburseToken: null } });
    fetchMock.mockResolvedValueOnce(response({ response_code: '00', disburse_token: 'new-token ' }))
      .mockImplementationOnce(async () => {
        const stored = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
        expect(stored.disburseToken).toBe('new-token');
        return rejected();
      })
      .mockResolvedValueOnce(statusResponse('pending'));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('processing');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).disburse_invoice).toBe('new-token');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).disburse_invoice).toBe('new-token');
    await expectBalances(3000, 2000);
  });

  it('PENDING : attend sans resoumettre ni recréditer', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse('pending'));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expectBalances(3000, 2000);
  });

  it.each(['success', 'failed'])('erreur Submit puis %s confirmé : clôture selon check-status', async (status) => {
    fetchMock.mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(rejected()).mockResolvedValueOnce(statusResponse(status));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe(status === 'success' ? 'completed' : 'failed');
    await expectBalances(status === 'success' ? 3000 : 5000, 0);
  });

  it.each(['pending', 'unknown'])('erreur Submit puis %s : conserve les fonds gelés', async (status) => {
    fetchMock.mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(rejected()).mockResolvedValueOnce(statusResponse(status));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expectBalances(3000, 2000);
  });

  it('erreur Submit puis CREATED : reprend avec le même token et la même référence', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(statusResponse('pending'));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('processing');
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[3][1].body);
    await expectBalances(3000, 2000);
  });

  it('limite les reprises immédiates si PayDunya reste CREATED', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(rejected()).mockResolvedValueOnce(statusResponse('created'));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await expectBalances(3000, 2000);
  });

  it('timeout de Submit : consulte check-status avant de décider', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse('created')).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(statusResponse('success'));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('completed');
    expect(log.error).toHaveBeenCalled();
    await expectBalances(3000, 0);
  });

  it('check-status indisponible après Submit : ne recrédite pas', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse('created')).mockResolvedValueOnce(rejected()).mockRejectedValueOnce(new Error('timeout'));
    expect((await attemptDisbursement(withdrawal.id, log)).status).toBe('processing');
    expect(log.error).toHaveBeenCalled();
    await expectBalances(3000, 2000);
    expect(await prisma.walletTransaction.count({ where: { walletUserId: userId, type: 'refund' } })).toBe(0);
  });
});
