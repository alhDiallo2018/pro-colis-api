import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

// Parcours HTTP réel sur la base _test : aucun GPS de livraison ne doit être
// réutilisé comme consentement de découverte. La carte expose une grille approximative.
// Les coordonnées des fixtures sont éloignées des comptes de démonstration locaux.
describe('vehicle and proximity discovery', () => {
  const suffix = Date.now().toString().slice(-7);
  const users = [];
  let client, near, far, zone;
  const auth = account => ({ Authorization: `Bearer ${account.accessToken}` });
  async function register(prefix, role) {
    const result = await request(app).post('/api/v1/auth/register').send({
      phone: `${prefix}${suffix}`, fullName: `Discovery ${prefix}`, pin: '123456', role
    });
    expect(result.status).toBe(201);
    users.push(result.body.user.id);
    return result.body;
  }
  beforeAll(async () => {
    client = await register('81', 'client');
    near = await register('82', 'driver');
    far = await register('83', 'driver');
    zone = await prisma.zone.create({ data: { name: `Discovery ${suffix}`, type: 'CIRCLE',
      latitude: '12.0', longitude: '-12.0', radiusKm: '30', city: 'Dakar', region: 'Dakar' } });
    for (const account of [near, far]) {
      await prisma.user.update({ where: { id: account.user.id }, data: { driverStatus: 'available' } });
      await prisma.zoneDriver.create({ data: { driverId: account.user.id, zoneId: zone.id } });
      const result = await request(app).put('/api/v1/driver/vehicle').set(auth(account)).send({
        plateNumber: `TEST-${account.user.id}`, model: 'Test', type: account === near ? 'Moto' : 'camion', capacity: account === near ? 20 : 2000
      });
      expect(result.status).toBe(201);
    }
  });
  afterAll(async () => {
    const parcelIds = (await prisma.parcel.findMany({ where: { senderId: client?.user.id }, select: { id: true } })).map(p => p.id);
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: users } }, { parcelId: { in: parcelIds } }] } });
    await prisma.parcelEvent.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.vehicle.deleteMany({ where: { driverId: { in: users } } });
    await prisma.zoneDriver.deleteMany({ where: { driverId: { in: users } } });
    if (zone) await prisma.zone.delete({ where: { id: zone.id } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  test('catalogue des six types, filtre type et poids avec zone réelle', async () => {
    const catalog = await request(app).get('/api/v1/public/vehicle-types');
    expect(catalog.body.vehicleTypes.map(t => t.value)).toEqual(['motorcycle', 'truck', 'van', 'tricycle', 'bus', 'gp']);
    const response = await request(app).get('/api/v1/public/drivers/search').query({ zoneId: zone.id, vehicleType: 'motorcycle', availableOnly: true });
    expect(response.status).toBe(200);
    expect(response.body.drivers.map(d => d.id)).toEqual([near.user.id]);
    expect(response.body.drivers[0].vehicleType).toBe('motorcycle');
    const heavy = await request(app).get('/api/v1/public/drivers/search').query({ zoneId: zone.id, minCapacity: 100, availableOnly: true });
    expect(heavy.body.drivers.map(d => d.id)).toEqual([far.user.id]);
  });
  test('proximité opt-in, suppression et expiration', async () => {
    for (const [account, latitude] of [[near, 12.001], [far, 12.1]]) {
      const response = await request(app).put('/api/v1/driver/discovery-location').set(auth(account)).send({ enabled: true, latitude, longitude: -12.0 });
      expect(response.status).toBe(200);
    }
    const query = { latitude: 12.0, longitude: -12.0, zoneId: zone.id };
    const map = await request(app).get('/api/v1/client/drivers/discovery').set(auth(client))
      .query({ ...query, radiusKm: 3 });
    expect(map.status).toBe(200);
    expect(map.body.drivers.map(d => d.id)).toEqual([near.user.id]);
    expect(map.body.categories.find(c => c.value === 'motorcycle').availableCount).toBe(1);
    expect(map.body.drivers[0].mapPosition.accuracyMeters).toBe(150);
    await request(app).get('/api/v1/client/drivers/discovery').query(query).expect(401);
    await request(app).get('/api/v1/client/drivers/discovery').set(auth(near)).query(query).expect(403);
    const response = await request(app).get('/api/v1/client/drivers/search').set(auth(client)).query(query);
    expect(response.status).toBe(200);
    expect(response.body.drivers.map(d => d.id)).toEqual([near.user.id, far.user.id]);
    expect(response.body.drivers[0].distanceKm).toBeCloseTo(0.1, 1);
    expect(JSON.stringify(response.body)).not.toMatch(/latitude|longitude|plateNumber|discoveryPosition/);
    await request(app).put('/api/v1/driver/discovery-location').set(auth(near)).send({ enabled: false }).expect(200);
    expect(await prisma.driverDiscoveryPosition.count({ where: { driverId: near.user.id } })).toBe(0);
    await prisma.driverDiscoveryPosition.update({ where: { driverId: far.user.id }, data: { updatedAt: new Date(Date.now() - 660000) } });
    const stale = await request(app).get('/api/v1/client/drivers/search').set(auth(client)).query(query);
    expect(stale.body.drivers.every(d => d.distanceKm === null)).toBe(true);
  });
  test('contrôles de rôle et coordonnées', async () => {
    await request(app).put('/api/v1/driver/discovery-location').send({ enabled: true }).expect(401);
    await request(app).put('/api/v1/driver/discovery-location').set(auth(client)).send({ enabled: true }).expect(403);
    await request(app).put('/api/v1/driver/discovery-location').set(auth(near)).send({ enabled: true, latitude: true, longitude: 0 }).expect(422);
  });
  test('propose directement et revérifie disponibilité et capacité', async () => {
    const payload = { receiverName: 'Test', receiverPhone: '+221770000000', description: 'Test discovery',
      departureZoneId: zone.id, driverId: near.user.id, vehicleType: 'motorcycle', weight: 2, totalAmount: 3000 };
    const response = await request(app).post('/api/v1/client/parcels/create').set(auth(client)).send(payload);
    expect(response.status).toBe(201);
    expect(response.body.parcel.proposedDriverId).toBe(near.user.id);
    expect(response.body.parcel.status).toBe('proposal_sent');
    await request(app).post('/api/v1/client/parcels/create').set(auth(client)).send({ ...payload, weight: 30 }).expect(409);
    await prisma.user.update({ where: { id: near.user.id }, data: { driverStatus: 'busy' } });
    await request(app).post('/api/v1/client/parcels/create').set(auth(client)).send(payload).expect(409);
    const available = await request(app).get('/api/v1/public/drivers/search').query({ zoneId: zone.id, availableOnly: true });
    expect(available.body.drivers.map(d => d.id)).not.toContain(near.user.id);
  });
});
