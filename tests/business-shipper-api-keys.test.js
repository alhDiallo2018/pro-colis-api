import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerPublic, authHeader, cleanupUsers } from './helpers.js';

const base = '/api/v1/business-shipper/api-keys';

describe('business-shipper api-keys (self-service)', () => {
  const users = [];
  let alice;
  let bob;
  const suffix = Date.now().toString().slice(-7);

  beforeAll(async () => {
    const a = await registerPublic(`11${suffix}`, 'Alice Shipper', 'client');
    const b = await registerPublic(`12${suffix}`, 'Bob Shipper', 'client');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    alice = { id: a.body.user.id, token: a.body.accessToken };
    bob = { id: b.body.user.id, token: b.body.accessToken };
    users.push(alice.id, bob.id);
  });

  afterAll(async () => {
    // Les clés sont supprimées par CASCADE sur created_by_id.
    await cleanupUsers(users);
    await prisma.$disconnect();
  });

  test('create retourne le secret une seule fois, puis list ne le renvoie plus', async () => {
    const created = await request(app).post(base).set(authHeader(alice.token)).send({
      partnerName: 'ERP interne',
      scopes: ['parcel.read', 'parcel.write']
    });
    expect(created.status).toBe(201);
    const keyId = created.body.key.keyId;
    expect(created.body.key.secretOnce).toMatch(/^.+\..+$/);
    expect(created.body.webhookSecretOnce).toBeTruthy();

    const list = await request(app).get(base).set(authHeader(alice.token));
    expect(list.status).toBe(200);
    const found = list.body.keys.find((k) => k.keyId === keyId);
    expect(found).toBeTruthy();
    expect(found.secretOnce).toBeUndefined();
    expect(found.scopes).toEqual(expect.arrayContaining(['parcel.read', 'parcel.write']));
  });

  test('un shipper ne voit pas les clés d\'un autre shipper', async () => {
    await request(app).post(base).set(authHeader(alice.token)).send({ partnerName: 'Clé Alice 2' });
    const list = await request(app).get(base).set(authHeader(bob.token));
    expect(list.status).toBe(200);
    expect(list.body.keys).toHaveLength(0);
  });

  test('rotate/update/deactivate renvoient 404 sur une clé qu\'on ne possède pas', async () => {
    const aliceKey = await request(app).post(base).set(authHeader(alice.token)).send({ partnerName: 'Clé ciblée' });
    const keyId = aliceKey.body.key.keyId;

    const rotate = await request(app).post(`${base}/${keyId}/rotate`).set(authHeader(bob.token));
    expect(rotate.status).toBe(404);

    const update = await request(app).patch(`${base}/${keyId}`).set(authHeader(bob.token)).send({ partnerName: 'Hijack' });
    expect(update.status).toBe(404);

    const deactivate = await request(app).post(`${base}/${keyId}/deactivate`).set(authHeader(bob.token));
    expect(deactivate.status).toBe(404);

    // La clé est toujours intacte côté Alice.
    const stillOwned = await prisma.apiKey.findUnique({ where: { keyId } });
    expect(stillOwned.partnerName).toBe('Clé ciblée');
    expect(stillOwned.active).toBe(true);
  });

  test('rotate renvoie un nouveau secret et met à jour rotatedAt', async () => {
    const created = await request(app).post(base).set(authHeader(alice.token)).send({ partnerName: 'À tourner' });
    const keyId = created.body.key.keyId;
    const before = await prisma.apiKey.findUnique({ where: { keyId } });

    const rotated = await request(app).post(`${base}/${keyId}/rotate`).set(authHeader(alice.token));
    expect(rotated.status).toBe(200);
    expect(rotated.body.key.secretOnce).toMatch(/^.+\..+$/);
    expect(rotated.body.key.secretOnce).not.toBe(created.body.key.secretOnce);

    const after = await prisma.apiKey.findUnique({ where: { keyId } });
    expect(after.keyHash).not.toBe(before.keyHash);
    expect(after.rotatedAt).not.toBeNull();
  });

  test('deactivate rend la clé inactive', async () => {
    const created = await request(app).post(base).set(authHeader(alice.token)).send({ partnerName: 'À désactiver' });
    const keyId = created.body.key.keyId;

    const off = await request(app).post(`${base}/${keyId}/deactivate`).set(authHeader(alice.token));
    expect(off.status).toBe(200);
    expect(off.body.key.active).toBe(false);
  });

  test('les scopes hors whitelist sont filtrés (pas d\'escalade)', async () => {
    const created = await request(app).post(base).set(authHeader(alice.token)).send({
      partnerName: 'Scope test',
      scopes: ['parcel.read', 'super_admin.wipe', 'webhook.receive']
    });
    expect(created.status).toBe(201);
    expect(created.body.key.scopes).toEqual(expect.arrayContaining(['parcel.read', 'webhook.receive']));
    expect(created.body.key.scopes).not.toContain('super_admin.wipe');
  });

  test('une clé partenaire créée côté super-admin reste invisible du shipper', async () => {
    const keyRow = await prisma.apiKey.create({
      data: {
        keyId: `biz_system_${suffix}`,
        keyHash: 'deadbeef',
        partnerName: 'Partenaire système',
        scopes: [],
        active: true,
        createdById: null
      }
    });
    const list = await request(app).get(base).set(authHeader(alice.token));
    expect(list.body.keys.find((k) => k.keyId === keyRow.keyId)).toBeUndefined();
    await prisma.apiKey.delete({ where: { id: keyRow.id } });
  });
});
