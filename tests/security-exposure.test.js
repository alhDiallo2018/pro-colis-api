import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, registerPublic, registerStaff, cleanupUsers } from './helpers.js';

/**
 * C7 — /public/parcels/free : aucune donnée personnelle exposée.
 * C8 — /super-admin/config : aucun secret PayDunya/Brevo exposé.
 * C9 — support : promotion de rôle interdite.
 */
describe('C7/C8/C9 - exposition de données, secrets et rôles', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const parcelIds = [];
  let superAdmin;
  let support;

  beforeAll(async () => {
    const sa = await registerStaff(`75${suffix}`, 'Super Admin Expo', 'super_admin');
    superAdmin = { userId: sa.userId, accessToken: sa.accessToken };
    userIds.push(sa.userId);
    const sup = await registerStaff(`74${suffix}`, 'Support Expo', 'support');
    support = { userId: sup.userId, accessToken: sup.accessToken };
    userIds.push(sup.userId);
  });

  afterAll(async () => {
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: 'paydunya.' } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------
  // C7 — PII sur /public/parcels/free
  // ------------------------------------------------------------
  describe('public free parcels', () => {
    it('n expose aucune donnée personnelle', async () => {
      const SENDER_PHONE = `+221771${suffix}`;
      const RECEIVER_PHONE = `+221772${suffix}`;
      const SENDER_EMAIL = `sender.${suffix}@example.com`;
      const RECEIVER_ADDRESS = `Adresse privée ${suffix}`;

      const driver = await registerPublic(`76${suffix}`, 'Driver Expo', 'driver');
      userIds.push(driver.body.user.id);

      const parcel = await prisma.parcel.create({
        data: {
          trackingNumber: `FREE-${suffix}`,
          senderId: driver.body.user.id,
          senderName: 'Expediteur Prive',
          senderPhone: SENDER_PHONE,
          senderEmail: SENDER_EMAIL,
          receiverName: 'Destinataire Prive',
          receiverPhone: RECEIVER_PHONE,
          receiverEmail: `recv.${suffix}@example.com`,
          receiverAddress: RECEIVER_ADDRESS,
          description: 'Colis public',
          weight: '2.00',
          status: 'free',
          isFreeForBidding: true,
          assignedDriverId: driver.body.user.id
        }
      });
      parcelIds.push(parcel.id);

      const res = await request(app).get('/api/v1/public/parcels/free');
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(SENDER_PHONE);
      expect(raw).not.toContain(RECEIVER_PHONE);
      expect(raw).not.toContain(SENDER_EMAIL);
      expect(raw).not.toContain(RECEIVER_ADDRESS);
      expect(raw).not.toContain('Expediteur Prive');
      expect(raw).not.toContain('Destinataire Prive');

      const found = res.body.parcels.find((p) => p.id === parcel.id);
      expect(found).toBeDefined();
      for (const key of [
        'senderName', 'senderPhone', 'senderEmail',
        'receiverName', 'receiverPhone', 'receiverEmail', 'receiverAddress',
        'driver', 'driverPhone', 'driverName', 'assignedDriver',
        'paymentStatus', 'paymentMethod', 'paymentPhoneNumber',
        'bids', 'proposal', 'negotiatedPrice', 'cashCollectedAmount'
      ]) {
        expect(found).not.toHaveProperty(key);
      }
      expect(raw).not.toMatch(/accessToken|refreshToken|"password"|"pin"|"hash"/);
    });
  });

  // ------------------------------------------------------------
  // C8 — secrets PayDunya dans /super-admin/config
  // ------------------------------------------------------------
  describe('super-admin config secrets', () => {
    it('masque les clés PayDunya (configured true, jamais le secret)', async () => {
      await prisma.systemConfig.upsert({ where: { key: 'paydunya.masterKey' }, update: { value: 'MK-SECRET-1111' }, create: { key: 'paydunya.masterKey', value: 'MK-SECRET-1111' } });
      await prisma.systemConfig.upsert({ where: { key: 'paydunya.privateKey' }, update: { value: 'PK-SECRET-2222' }, create: { key: 'paydunya.privateKey', value: 'PK-SECRET-2222' } });
      await prisma.systemConfig.upsert({ where: { key: 'paydunya.token' }, update: { value: 'TK-SECRET-3333' }, create: { key: 'paydunya.token', value: 'TK-SECRET-3333' } });
      await prisma.systemConfig.upsert({ where: { key: 'score.deliveryCompleted' }, update: { value: 10 }, create: { key: 'score.deliveryCompleted', value: 10 } });

      const res = await request(app).get('/api/v1/super-admin/config').set(authHeader(superAdmin.accessToken));
      expect(res.status).toBe(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('MK-SECRET-1111');
      expect(raw).not.toContain('PK-SECRET-2222');
      expect(raw).not.toContain('TK-SECRET-3333');
      expect(raw).not.toContain('masterKey');
      expect(raw).not.toContain('privateKey');

      expect(res.body.config.paydunya).toEqual({ configured: true });
      expect(res.body.config['score.deliveryCompleted']).toBe(10);
    });
  });

  // ------------------------------------------------------------
  // C9 — support : promotion de rôle interdite
  // ------------------------------------------------------------
  describe('support role promotion', () => {
    it('refuse à un support de changer le rôle d un utilisateur (403)', async () => {
      const client = await registerPublic(`77${suffix}`, 'Client Cible', 'client');
      userIds.push(client.body.user.id);

      const res = await request(app)
        .patch(`/api/v1/super-admin/users/${client.body.user.id}/role`)
        .set(authHeader(support.accessToken))
        .send({ role: 'admin' });
      expect(res.status).toBe(403);

      const stored = await prisma.user.findUnique({ where: { id: client.body.user.id } });
      expect(stored.role).toBe('client');
    });

    it('refuse à un support de créer un compte super_admin (403)', async () => {
      const res = await request(app)
        .post('/api/v1/super-admin/users')
        .set(authHeader(support.accessToken))
        .send({ phone: `73${suffix}`, fullName: 'Escalade', pin: '123456', role: 'super_admin' });
      expect(res.status).toBe(403);

      const created = await prisma.user.findFirst({ where: { phone: `73${suffix}` } });
      expect(created).toBeNull();
    });

    it('autorise un support à créer un compte public (client)', async () => {
      const res = await request(app)
        .post('/api/v1/super-admin/users')
        .set(authHeader(support.accessToken))
        .send({ phone: `72${suffix}`, fullName: 'Client Support', pin: '123456', role: 'client' });
      expect(res.status).toBe(201);
      userIds.push(res.body.user.id);
      expect(res.body.user.role).toBe('client');
    });

    it('autorise le super admin à changer un rôle', async () => {
      const client = await registerPublic(`71${suffix}`, 'Client Promu', 'client');
      userIds.push(client.body.user.id);

      const res = await request(app)
        .patch(`/api/v1/super-admin/users/${client.body.user.id}/role`)
        .set(authHeader(superAdmin.accessToken))
        .send({ role: 'admin' });
      expect(res.status).toBe(200);

      const stored = await prisma.user.findUnique({ where: { id: client.body.user.id } });
      expect(stored.role).toBe('admin');
    });
  });
});
