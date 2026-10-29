import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerPublic, authHeader, cleanupUsers } from './helpers.js';

describe('import navette transactionnel', () => {
  const users = [], zones = [];
  const suffix = Date.now().toString().slice(-7);
  let driver, other, client, car;
  const upload = (csv, { preview = false, account = driver, name = 'lignes.csv' } = {}) =>
    request(app).post(`/api/v1/driver/route-templates/import${preview ? '/preview' : ''}`)
      .set(authHeader(account.token)).attach('file', Buffer.from(csv), name);
  const csv = () => `ligne;zone;minutes\n45;${zones[0].id};0\n45;${zones[1].id};90`;
  beforeAll(async () => {
    for (const [prefix, role, type] of [['51', 'driver', 'bus'], ['52', 'driver', 'bus'], ['53', 'client'], ['54', 'driver', 'car']]) {
      const res = await registerPublic(prefix + suffix, 'Import test', role);
      expect(res.status).toBe(201);
      const account = { id: res.body.user.id, token: res.body.accessToken };
      users.push(account.id);
      if (!driver) driver = account; else if (!other) other = account; else if (!client) client = account; else car = account;
      if (type) await prisma.vehicle.create({ data: { driverId: account.id, plateNumber: `CSV-${prefix}-${suffix}`, model: 'Test', type, capacity: 100 } });
    }
    for (const name of ['Départ', 'Arrivée', 'Homonyme', 'Homonyme']) {
      zones.push(await prisma.zone.create({ data: { name: `${name} ${suffix}`, latitude: 14.7, longitude: -17.4 } }));
    }
  });
  afterAll(async () => {
    await prisma.routeTemplate.deleteMany({ where: { driverId: { in: users } } });
    await prisma.vehicle.deleteMany({ where: { driverId: { in: users } } });
    await prisma.zone.deleteMany({ where: { id: { in: zones.map(z => z.id) } } });
    await cleanupUsers(users);
    await prisma.$disconnect();
  });
  test('aperçu sans écriture puis import idempotent dans le carnet personnel', async () => {
    const preview = await upload(csv(), { preview: true });
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBe(1);
    expect(await prisma.routeTemplate.count({ where: { driverId: driver.id } })).toBe(0);
    const imported = await upload(csv());
    expect(imported.status).toBe(200);
    const template = imported.body.templates[0];
    expect(template.data.itinerary).toMatchObject({ serviceType: 'shuttle', lineNumber: '45' });
    expect(template.data.itinerary.stops).toHaveLength(2);
    expect(template.data.itinerary.stops[0]).not.toHaveProperty('scheduledAt');
    expect(template.data.proposedPrice).toBeNull();
    expect((await upload(csv())).body.templates[0].id).toBe(template.id);
    expect(await prisma.advertisement.count({ where: { driverId: driver.id } })).toBe(0);
    const own = await request(app).get('/api/v1/driver/route-templates').set(authHeader(other.token));
    expect(own.body.templates).toEqual([]);
  });
  test('zone ambiguë, inconnue ou doublonnée : aucune écriture partielle', async () => {
    const before = await prisma.routeTemplate.count({ where: { driverId: driver.id } });
    for (const zone of [zones[2].name, 'zone-inconnue', zones[0].id]) {
      const res = await upload(csv() + `\n46;${zones[0].id};0\n46;${zone};90`);
      expect(res.status).toBe(422);
    }
    expect(await prisma.routeTemplate.count({ where: { driverId: driver.id } })).toBe(before);
  });
  test('contrôle rôle, véhicule, extension et taille du fichier', async () => {
    expect((await upload(csv(), { account: client })).status).toBe(403);
    expect((await upload(csv(), { account: car })).status).toBe(422);
    expect((await upload(csv(), { account: other, name: 'lignes.xlsx' })).status).toBe(422);
    expect((await upload('x'.repeat(128 * 1024 + 1), { account: other })).status).toBe(422);
    expect((await request(app).post('/api/v1/driver/route-templates/import').set(authHeader(other.token))).status).toBe(422);
    expect((await request(app).post('/api/v1/driver/route-templates/import')).status).toBe(401);
  });
});
