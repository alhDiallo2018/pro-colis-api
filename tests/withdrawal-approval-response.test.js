import { jest } from '@jest/globals';

// Le prestataire est simulé pour vérifier le contrat HTTP sans déclencher de
// versement réel. La transaction d'approbation est isolée de toute base externe.
const attemptDisbursement = jest.fn();
jest.unstable_mockModule('../src/utils/withdrawal-flow.js', () => ({
  attemptDisbursement,
  setWithdrawalTransactionStatus: jest.fn(),
  toClientWithdrawalStatus: (status) => ({ completed: 'SUCCESS' }[status] ?? status.toUpperCase()),
  fromClientWithdrawalStatus: jest.fn()
}));

const { approveWithdrawal } = await import('../src/modules/admin-finance.controller.js');
const { prisma } = await import('../src/config/prisma.js');

describe('réponse HTTP de l’approbation des retraits', () => {
  let req;
  let res;
  let transaction;

  beforeEach(() => {
    req = { params: { withdrawalId: 'withdrawal-test' }, user: { id: 'admin-test' }, headers: {}, log: { warn: jest.fn(), error: jest.fn() } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    transaction = jest.spyOn(prisma, '$transaction').mockImplementation(async (fn) => fn({
      withdrawal: {
        findUnique: jest.fn().mockResolvedValue({ id: 'withdrawal-test', status: 'pending' }),
        update: jest.fn().mockResolvedValue({ id: 'withdrawal-test', status: 'processing' })
      },
      auditLog: { create: jest.fn() }
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('retourne 502 et success=false lorsque PayDunya refuse le versement', async () => {
    attemptDisbursement.mockResolvedValue({ id: 'withdrawal-test', status: 'failed', failureReason: 'Callback PayDunya inaccessible' });
    await approveWithdrawal(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      status: 'FAILED',
      error: { code: 'WITHDRAWAL_DISBURSEMENT_FAILED', details: [] },
      withdrawal: { id: 'withdrawal-test', status: 'FAILED', failureReason: 'Callback PayDunya inaccessible' }
    }));
    expect(req.log.warn).toHaveBeenCalled();
  });

  it.each([
    [{ id: 'withdrawal-test', status: 'completed' }, 'SUCCESS'],
    [{ id: 'withdrawal-test', status: 'processing' }, 'PROCESSING'],
    [null, 'PROCESSING']
  ])('conserve une réponse positive pour un versement réussi, en attente ou manuel (%j)', async (result, status) => {
    attemptDisbursement.mockResolvedValue(result);
    await approveWithdrawal(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, status }));
  });

  it('intercepte et journalise une erreur de base avant tout versement', async () => {
    transaction.mockRejectedValue(new Error('Database unavailable'));
    await approveWithdrawal(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(req.log.error).toHaveBeenCalled();
    expect(attemptDisbursement).not.toHaveBeenCalled();
  });
});
