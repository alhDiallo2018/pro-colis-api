import { jest } from '@jest/globals';
import { prisma } from '../src/config/prisma.js';
import { resolveZone } from '../src/modules/zones/zone.controller.js';

const existing = { id: 'old-zone', name: 'Dakar', latitude: 14.69, longitude: -17.44, radiusKm: 30,
  status: 'approved', isActive: true, createdAt: new Date(), updatedAt: new Date() };
let created;
let tx;
beforeEach(() => {
  jest.spyOn(prisma.zone, 'findUnique').mockResolvedValue(null);
  jest.spyOn(prisma.zone, 'findMany').mockResolvedValue([existing]);
  tx = {
    zone: { create: jest.fn(async ({ data }) => { created = { ...existing, ...data, id: 'new-zone' }; return created; }), update: jest.fn() },
    garage: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'mirror', name: 'Rue', latitude: 14.7, longitude: -17.45 }) },
    auditLog: { create: jest.fn() }
  };
  jest.spyOn(prisma, '$transaction').mockImplementation(fn => fn(tx));
});
afterEach(() => jest.restoreAllMocks());
async function resolve(body) {
  const req = { body, user: { id: 'user' }, headers: {}, log: { error: jest.fn() } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await resolveZone(req, res);
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

test('un lieu mondial choisi ne devient pas le centre d’une zone couvrante', async () => {
  const result = await resolve({ placeId: 'precise-place', name: 'Rue précise', latitude: 14.7, longitude: -17.45 });
  expect(result.status).toBe(201);
  expect(result.body.data.id).toBe('new-zone');
  expect(result.body.data.latitude).toBe(14.7);
  expect(created.placeId).toBe('precise-place');
});

test('un point manuel utilise ses coordonnées comme identité, pas le placeId de la rue', async () => {
  const result = await resolve({ exactPoint: true, placeId: 'whole-street', name: 'Rendez-vous', latitude: 14.7123456, longitude: -17.4123456 });
  expect(result.status).toBe(201);
  expect(created.placeId).toBe('point:14.7123456,-17.4123456');
  expect(result.body.data.longitude).toBe(-17.4123456);
  expect(tx.garage.findFirst.mock.calls[0][0].where).toMatchObject({ latitude: '14.7123456', longitude: '-17.4123456' });
});

test.each([null, '', true, 91, 'Infinity'])('refuse une latitude invalide %j avant la BD', async latitude => {
  const result = await resolve({ exactPoint: true, name: 'Rue', latitude, longitude: 0 });
  expect(result.status).toBe(422);
  expect(prisma.zone.findMany).not.toHaveBeenCalled();
});
