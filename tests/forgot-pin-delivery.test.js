import { jest } from '@jest/globals';

// Les transports sont simules : ces tests ne transmettent aucun email/SMS.
const forgot = jest.fn();
const configured = jest.fn();
const sms = jest.fn();
const email = jest.fn();
jest.unstable_mockModule('../src/modules/auth/auth.service.js', () => ({ forgotPassword: forgot }));
jest.unstable_mockModule('../src/utils/brevo.js', () => ({
  isBrevoConfigured: () => false,
  isBrevoConfiguredAsync: configured,
  sendOtpSms: sms,
  sendOtpEmail: email
}));
const { forgotPassword } = await import('../src/modules/auth/auth.controller.js');
const { env } = await import('../src/config/env.js');
const originalNodeEnv = env.NODE_ENV;
let req;
let res;

beforeEach(() => {
  jest.resetAllMocks();
  env.NODE_ENV = 'production';
  forgot.mockResolvedValue({ code: '726198', phone: '+221770000001', email: 'pin@example.test' });
  configured.mockResolvedValue(true);
  sms.mockResolvedValue({ messageId: 'sms-test' });
  email.mockResolvedValue({ messageId: 'email-test' });
  req = { validated: { body: { identifier: 'pin@example.test' } }, requestId: 'test-request', log: { error: jest.fn() } };
  res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
});
afterEach(() => { env.NODE_ENV = originalNodeEnv; });

function noOtpDisclosure() {
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('726198');
  expect(JSON.stringify(req.log.error.mock.calls)).not.toContain('726198');
}

test('attend la configuration chargee et la reponse email avant de confirmer', async () => {
  let resolveConfig;
  let resolveEmail;
  configured.mockReturnValue(new Promise(resolve => { resolveConfig = resolve; }));
  email.mockReturnValue(new Promise(resolve => { resolveEmail = resolve; }));
  sms.mockResolvedValue(null);
  const pending = forgotPassword(req, res);
  await Promise.resolve();
  expect(email).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
  resolveConfig(true);
  await Promise.resolve();
  expect(email).toHaveBeenCalledTimes(1);
  expect(res.json).not.toHaveBeenCalled();
  resolveEmail({ messageId: 'accepted' });
  await pending;
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, sent: true });
  noOtpDisclosure();
});

test('repond 503 sans fournisseur, sans simuler un envoi', async () => {
  configured.mockResolvedValue(false);
  await forgotPassword(req, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(sms).not.toHaveBeenCalled();
  expect(email).not.toHaveBeenCalled();
  noOtpDisclosure();
});

test('repond 503 lorsque aucun canal ne confirme l acceptation', async () => {
  sms.mockRejectedValue(new Error('provider unavailable'));
  email.mockResolvedValue(null);
  await forgotPassword(req, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json.mock.calls[0][0].error.code).toBe('OTP_DELIVERY_UNAVAILABLE');
  noOtpDisclosure();
});

test('un SMS accepte suffit si l email echoue', async () => {
  email.mockRejectedValue(new Error('provider unavailable'));
  await forgotPassword(req, res);
  expect(res.status).toHaveBeenCalledWith(200);
  noOtpDisclosure();
});

test('une erreur BD est geree et loguee sans identifiant ni secret', async () => {
  forgot.mockRejectedValue(new Error('private details'));
  await forgotPassword(req, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(req.log.error).toHaveBeenCalled();
  expect(JSON.stringify(req.log.error.mock.calls)).not.toContain('private details');
  expect(JSON.stringify(req.log.error.mock.calls)).not.toContain('pin@example.test');
});
