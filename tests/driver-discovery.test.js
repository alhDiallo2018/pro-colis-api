import { jest } from '@jest/globals';
import { prisma } from '../src/config/prisma.js';
import { discoverDrivers, coordinate, distanceKm } from '../src/modules/drivers/discovery.service.js';
import { shareDiscoveryPosition, upsertDriverVehicle } from '../src/modules/mobile/mobile.controller.js';
import { normalizeVehicleType } from '../src/utils/vehicle-types.js';

const actor = { id: 'driver-1', role: 'driver' };
function driver(id, lat, age = 0) {
  return { id, fullName: id, driverStatus: 'available', vehicles: [{ type: 'van', model: 'HiAce', capacity: 1200 }],
    discoveryPosition: lat == null ? null : { latitude: lat, longitude: -17.45, updatedAt: new Date(Date.now() - age) } };
}
afterEach(() => jest.restoreAllMocks());

test.each([['Moto', 'motorcycle'], ['camion', 'truck'], ['Fourgonnette', 'van'], ['tricycle', 'tricycle'], ['Tata', 'bus'], ['horaire', 'bus'], ['GP', 'gp']])('normalise %s', (input, expected) => {
  expect(normalizeVehicleType(input)).toBe(expected);
});
test.each([true, null, '', ' ', 'Infinity', 91])('rejette latitude %j', value => {
  expect(() => coordinate(value, 'latitude', -90, 90)).toThrow();
});
test('la distance est réelle et nulle au même point', () => {
  expect(distanceKm(14.7, -17.45, 14.7, -17.45)).toBe(0);
  expect(distanceKm(0, 0, 1, 0)).toBeCloseTo(111.195, 2);
});
test('filtre avant pagination et ne retourne jamais les coordonnées', async () => {
  const spy = jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
    driver('far', 15), driver('stale', 14.7, 11 * 60 * 1000), driver('near', 14.701), driver('unknown', null)
  ]);
  const result = await discoverDrivers({ latitude: 14.7, longitude: -17.45, vehicleType: 'van', minCapacity: '5', limit: '3' }, actor);
  expect(result.map(d => d.id)).toEqual(['near', 'far', 'stale']);
  expect(result[2].distanceKm).toBeNull();
  expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|discoveryPosition|phone|plateNumber/);
  expect(spy.mock.calls[0][0].take).toBeUndefined();
  expect(spy.mock.calls[0][0].where).toMatchObject({ driverStatus: 'available', vehicles: { some: { capacity: { gte: 5 } } } });
});
test('sans GPS, ne lit aucune position et garde le filtre de zone', async () => {
  const spy = jest.spyOn(prisma.user, 'findMany').mockResolvedValue([driver('driver', null)]);
  const result = await discoverDrivers({ availableOnly: 'true', verifiedOnly: 'true' }, null, { garageId: 'garage' });
  expect(spy.mock.calls[0][0].select.discoveryPosition).toBeUndefined();
  expect(spy.mock.calls[0][0].where).toMatchObject({ garageId: 'garage', isVerified: true });
  expect(result[0].distanceKm).toBeUndefined();
});
test.each([{ latitude: 0 }, { limit: -1 }, { limit: 500 }, { minCapacity: -2 }, { vehicleType: 'spaceship' }])('rejette filtre invalide %j', async query => {
  const spy = jest.spyOn(prisma.user, 'findMany');
  await expect(discoverDrivers(query, actor)).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
});
test('proximité réservée aux sessions authentifiées', async () => {
  await expect(discoverDrivers({ latitude: 0, longitude: 0 }, null)).rejects.toThrow();
});
async function call(handler, body) {
  const req = { user: actor, body, log: { error: jest.fn(), warn: jest.fn() } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await handler(req, res);
  return { req, status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}
test('partage volontaire attaché uniquement au chauffeur authentifié', async () => {
  const spy = jest.spyOn(prisma.driverDiscoveryPosition, 'upsert').mockResolvedValue({});
  const result = await call(shareDiscoveryPosition, { enabled: true, driverId: 'another', latitude: 14.7, longitude: -17.45 });
  expect(result.status).toBe(200);
  expect(spy.mock.calls[0][0].where).toEqual({ driverId: actor.id });
  expect(result.body.expiresAt).toBeInstanceOf(Date);
});
test('désactiver supprime la position volontaire sans toucher au suivi colis', async () => {
  const spy = jest.spyOn(prisma.driverDiscoveryPosition, 'deleteMany').mockResolvedValue({ count: 1 });
  const result = await call(shareDiscoveryPosition, { enabled: false });
  expect(result.status).toBe(200);
  expect(spy).toHaveBeenCalledWith({ where: { driverId: actor.id } });
});
test('une erreur BD est interceptée et journalisée', async () => {
  jest.spyOn(prisma.driverDiscoveryPosition, 'deleteMany').mockRejectedValue(new Error('DB failed'));
  const result = await call(shareDiscoveryPosition, { enabled: false });
  expect(result.status).toBe(500);
  expect(result.req.log.error).toHaveBeenCalled();
});
test('refuse un type inconnu avant écriture du véhicule', async () => {
  const spy = jest.spyOn(prisma.vehicle, 'findFirst');
  const result = await call(upsertDriverVehicle, { type: 'spaceship', plateNumber: 'DK01', model: 'Test' });
  expect(result.status).toBe(422);
  expect(spy).not.toHaveBeenCalled();
});

describe('map discovery', () => {
  let mapSearch;
  beforeAll(async () => { mapSearch = (await import('../src/modules/drivers/discovery.service.js')).discoverDriverMap; });
  test('compte les catégories dans le rayon puis filtre, sans garage imposé', async () => {
    const nearby = driver('near', 14.701234);
    nearby.discoveryPosition.longitude = -17.450321;
    nearby.vehicles[0].type = 'Moto';
    const truck = driver('truck', 14.71); truck.vehicles[0].type = 'truck';
    const distant = driver('distant', 16);
    const stale = driver('stale', 14.7, 660000);
    const unknown = driver('unknown', null);
    const spy = jest.spyOn(prisma.user, 'findMany').mockResolvedValue([nearby, truck, distant, stale, unknown]);
    const result = await mapSearch({ latitude: 14.7, longitude: -17.45, radiusKm: 3, vehicleType: 'motorcycle' }, { role: 'client' });
    expect(result.drivers.map(d => d.id)).toEqual(['near']);
    expect(result.categories.find(t => t.value === 'truck').availableCount).toBe(1);
    expect(result.categories.find(t => t.value === 'motorcycle').availableCount).toBe(1);
    expect(result.search.total).toBe(1);
    expect(result.drivers[0].mapPosition).toEqual({ latitude: 14.701, longitude: -17.45, accuracyMeters: 150 });
    expect(JSON.stringify(result)).not.toContain('14.701234');
    expect(JSON.stringify(result)).not.toContain('-17.450321');
    expect(spy.mock.calls[0][0].where.garageId).toBeUndefined();
    expect(spy.mock.calls[0][0].take).toBeUndefined();
  });
  test('positions futures ou expirées exclues de la carte', async () => {
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([driver('future', 14.7, -60000), driver('old', 14.7, 660000)]);
    const result = await mapSearch({ latitude: 14.7, longitude: -17.45 }, { role: 'client' });
    expect(result.drivers).toEqual([]);
    expect(result.categories.every(t => t.availableCount === 0)).toBe(true);
  });
  test.each([{}, { radiusKm: 0, latitude: 0, longitude: 0 }, { radiusKm: 101, latitude: 0, longitude: 0 }])('valide le point et le rayon %j', async query => {
    await expect(mapSearch(query, { role: 'client' })).rejects.toThrow();
  });
  test('refuse la carte à un visiteur et au rôle chauffeur', async () => {
    await expect(mapSearch({ latitude: 0, longitude: 0 }, null)).rejects.toThrow();
    await expect(mapSearch({ latitude: 0, longitude: 0 }, { role: 'driver' })).rejects.toThrow();
  });
});
