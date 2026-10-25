import { jest } from '@jest/globals';
import { createHash, randomUUID, randomInt, generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

// Aucune livraison SMS ni authentification Google réelle dans les tests.
// Les transactions, contraintes d'unicité et sessions utilisent PostgreSQL test.
const brevo = await import('../src/utils/brevo.js');
const sendSms = jest.fn().mockResolvedValue({ messageId: 'test' });
jest.unstable_mockModule('../src/utils/brevo.js', () => ({ ...brevo, sendOtpSms: sendSms }));
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/prisma.js');
const { env } = await import('../src/config/env.js');
const auth = await import('../src/modules/auth/auth.service.js');
const google = await import('../src/modules/auth/google.service.js');
const { sanitizeForLog } = await import('../src/config/logger.js');

const ids = [];
const subjects = [];
const clientId = 'test-web.apps.googleusercontent.com';
const phone = () => `+2217${randomInt(10000000, 99999999)}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const challengeWhere = value => ({ tokenHash: hash(value.challengeToken) });
let verify;

beforeEach(() => {
  env.GOOGLE_WEB_CLIENT_ID = clientId;
  verify = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken');
  sendSms.mockClear();
  sendSms.mockResolvedValue({ messageId: 'test' });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  const created = await prisma.user.findMany({ where: { googleSubject: { in: subjects } }, select: { id: true } });
  const userIds = [...ids, ...created.map(user => user.id)];
  await prisma.googleAuthChallenge.deleteMany({ where: { googleSubject: { in: subjects } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.score.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

async function start(email = `google-${randomUUID()}@example.test`, claimOverrides = {}) {
  const sub = `google-test-${randomUUID()}`;
  subjects.push(sub);
  verify.mockResolvedValue({ getPayload: () => ({ sub, email, email_verified: true, name: 'Utilisateur Google', ...claimOverrides }) });
  return google.startGoogle({ idToken: 'verified-google-id-token' });
}
async function existing() {
  const result = await auth.registerUser({ phone: phone(), email: `existing-${randomUUID()}@example.test`, fullName: 'Compte existant', pin: '123456' });
  ids.push(result.user.id);
  return result;
}
async function registration() {
  const challenge = await start();
  const number = phone();
  await google.sendGooglePhoneOtp({ challengeToken: challenge.challengeToken, phone: number });
  const code = sendSms.mock.calls.at(-1)[0].code;
  return { challenge, payload: { challengeToken: challenge.challengeToken, phone: number, otpCode: code,
    fullName: 'Nouveau compte', pin: '654321', role: 'client', acceptedTerms: true } };
}

test('configuration publique, Google désactivé sans identifiant OAuth', async () => {
  env.GOOGLE_WEB_CLIENT_ID = '';
  const response = await request(app).get('/api/v1/auth/google/config');
  expect(response.body).toMatchObject({ enabled: false, serverClientId: null });
  expect(response.headers['cache-control']).toBe('no-store');
  expect((await request(app).post('/api/v1/auth/google').send({ idToken: 'invalid-token-long-enough' })).status).toBe(503);
  expect(verify).not.toHaveBeenCalled();
});

test('rejette les jetons invalides/expirés et les emails non vérifiés', async () => {
  verify.mockRejectedValue(new Error('Invalid signature or expired token'));
  const response = await request(app).post('/api/v1/auth/google').send({ idToken: 'invalid-token-long-enough' });
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('GOOGLE_TOKEN_INVALID');
  expect(verify).toHaveBeenCalledWith({ idToken: 'invalid-token-long-enough', audience: clientId });
  await expect(start(undefined, { email_verified: false })).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_UNVERIFIED' });
});

test('un email existant exige le PIN, puis utilise les sessions habituelles', async () => {
  const user = await existing();
  const challenge = await start(user.user.email);
  expect(challenge.status).toBe('link_required');
  expect(challenge.accessToken).toBeUndefined();
  expect(await prisma.user.findUnique({ where: { id: user.user.id } })).toMatchObject({ googleSubject: null });
  await expect(google.linkGoogle({ challengeToken: challenge.challengeToken, identifier: user.user.email, pin: '000000' })).rejects.toMatchObject({ code: 'GOOGLE_PROOF_INVALID' });
  expect(await prisma.googleAuthChallenge.findUnique({ where: challengeWhere(challenge) })).toMatchObject({ attempts: 1 });
  const result = await google.linkGoogle({ challengeToken: challenge.challengeToken, identifier: user.user.email, pin: '123456' });
  expect(result.user.id).toBe(user.user.id);
  expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${result.accessToken}`)).status).toBe(200);
  expect((await auth.refreshAccessToken(result.refreshToken)).accessToken).toBeTruthy();
  await expect(google.linkGoogle({ challengeToken: challenge.challengeToken, identifier: user.user.email, pin: '123456' })).rejects.toMatchObject({ code: 'GOOGLE_CHALLENGE_EXPIRED' });
  expect((await google.startGoogle({ idToken: 'verified-google-id-token' })).user.id).toBe(user.user.id);
});

test('refuse les comptes désactivés et les demandes expirées', async () => {
  const user = await existing();
  const challenge = await start(user.user.email);
  await prisma.user.update({ where: { id: user.user.id }, data: { status: 'suspended' } });
  await expect(google.linkGoogle({ challengeToken: challenge.challengeToken, identifier: user.user.email, pin: '123456' })).rejects.toMatchObject({ statusCode: 401 });
  await prisma.googleAuthChallenge.update({ where: challengeWhere(challenge), data: { expiresAt: new Date(0) } });
  await expect(google.linkGoogle({ challengeToken: challenge.challengeToken, identifier: user.user.email, pin: '123456' })).rejects.toMatchObject({ code: 'GOOGLE_CHALLENGE_EXPIRED' });
});

test('verrouille le challenge après cinq mauvaises preuves', async () => {
  const user = await existing();
  const challenge = await start(user.user.email);
  for (let i = 0; i < 5; i++) {
    await expect(google.linkGoogle({ challengeToken: challenge.challengeToken, identifier: user.user.email, pin: '000000' })).rejects.toMatchObject({ code: 'GOOGLE_PROOF_INVALID' });
  }
  await expect(google.linkGoogle({ challengeToken: challenge.challengeToken, identifier: user.user.email, pin: '123456' })).rejects.toMatchObject({ code: 'GOOGLE_CHALLENGE_EXPIRED' });
});

test('inscription atomique, téléphone vérifié, PIN utilisable et aucun rejeu concurrent', async () => {
  const { payload } = await registration();
  const results = await Promise.allSettled([google.registerGoogle(payload), google.registerGoogle(payload)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const result = results.find(r => r.status === 'fulfilled').value;
  expect(result.status).toBe('authenticated');
  const created = await prisma.user.findUnique({ where: { id: result.user.id } });
  expect(created).toMatchObject({ isPhoneVerified: true, isEmailVerified: true, role: 'client' });
  expect((await auth.loginWithPin({ identifier: payload.phone, pin: payload.pin })).user.id).toBe(result.user.id);
});

test('SMS lié au téléphone et au challenge, secret haché et cooldown', async () => {
  const { challenge, payload } = await registration();
  const row = await prisma.googleAuthChallenge.findUnique({ where: challengeWhere(challenge) });
  expect(row.otpHash).not.toBe(payload.otpCode);
  expect(row.tokenHash).not.toBe(payload.challengeToken);
  await expect(google.sendGooglePhoneOtp({ challengeToken: payload.challengeToken, phone: payload.phone })).rejects.toMatchObject({ code: 'OTP_COOLDOWN' });
  await expect(google.registerGoogle({ ...payload, phone: phone() })).rejects.toMatchObject({ code: 'GOOGLE_PROOF_INVALID' });
  await prisma.googleAuthChallenge.update({ where: challengeWhere(challenge), data: { expiresAt: new Date(0) } });
  await expect(google.registerGoogle(payload)).rejects.toMatchObject({ code: 'GOOGLE_CHALLENGE_EXPIRED' });
});

test('une panne SMS ne renvoie pas le code et permet un nouvel envoi', async () => {
  const challenge = await start();
  const payload = { challengeToken: challenge.challengeToken, phone: phone() };
  sendSms.mockResolvedValueOnce(null);
  await expect(google.sendGooglePhoneOtp(payload)).rejects.toMatchObject({ code: 'OTP_DELIVERY_UNAVAILABLE' });
  expect(await google.sendGooglePhoneOtp(payload)).toEqual({ sent: true, retryAfterSeconds: 60 });
});

test('un téléphone existant exige son PIN et garde son email/son rôle', async () => {
  const user = await existing();
  const { payload } = await registration();
  // Simule la saisie du téléphone existant avant le premier envoi SMS.
  await prisma.googleAuthChallenge.update({ where: { tokenHash: hash(payload.challengeToken) }, data: { phone: user.user.phone } });
  const result = await google.registerGoogle({ ...payload, phone: user.user.phone, role: 'driver' });
  expect(result).toMatchObject({ status: 'link_required', identifier: user.user.phone });
  await expect(google.linkGoogle({ challengeToken: payload.challengeToken, identifier: user.user.phone, pin: payload.pin })).rejects.toMatchObject({ code: 'GOOGLE_PROOF_INVALID' });
  const linked = await google.linkGoogle({ challengeToken: payload.challengeToken, identifier: user.user.phone, pin: '123456' });
  expect(linked.user).toMatchObject({ id: user.user.id, email: user.user.email, role: 'client' });
});

test('refuse les rôles privilégiés et les conditions non acceptées', async () => {
  const { payload } = await registration();
  for (const invalid of [{ ...payload, role: 'admin' }, { ...payload, acceptedTerms: false }]) {
    expect((await request(app).post('/api/v1/auth/google/register').send(invalid)).status).toBe(422);
  }
  expect(await prisma.user.count({ where: { phone: payload.phone } })).toBe(0);
});

test('les nouvelles valeurs sensibles sont masquées dans les journaux', () => {
  expect(sanitizeForLog({ idToken: 'private', challengeToken: 'private', nested: { otpHash: 'private', pin: '123456' } }))
    .toEqual({ idToken: '[REDACTED]', challengeToken: '[REDACTED]', nested: { otpHash: '[REDACTED]', pin: '[REDACTED]' } });
});

// Verifie aussi le contrat cryptographique avec de vraies signatures locales,
// sans confondre la validation du SDK et le mock des parcours metier.
test('la verification reelle refuse mauvaise audience, emetteur, signature et expiration', async () => {
  verify.mockRestore();
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  jest.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { local: pair.publicKey.export({ type: 'spki', format: 'pem' }) }, format: 'PEM'
  });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: clientId, sub: 'local-test', email: 'test@example.test', email_verified: true, iat: now, exp: now + 3600 };
  for (const changes of [{ aud: 'attacker.apps.googleusercontent.com' }, { iss: 'https://attacker.example' }, { iat: now - 7200, exp: now - 3600 }]) {
    const idToken = jwt.sign({ ...claims, ...changes }, pair.privateKey, { algorithm: 'RS256', keyid: 'local' });
    await expect(google.startGoogle({ idToken })).rejects.toMatchObject({ code: 'GOOGLE_TOKEN_INVALID' });
  }
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const invalidSignature = jwt.sign(claims, other.privateKey, { algorithm: 'RS256', keyid: 'local' });
  await expect(google.startGoogle({ idToken: invalidSignature })).rejects.toMatchObject({ code: 'GOOGLE_TOKEN_INVALID' });
});
