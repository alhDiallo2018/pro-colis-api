import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { registerStaff, authHeader, cleanupUsers } from './helpers.js';

const base = '/api/v1/shuttle-operator';

describe('shuttle-operator CRUD (RBAC + ownership)', () => {
  const users = [];
  let alice;
  let bob;
  let zone1;
  let zone2;
  const suffix = Date.now().toString().slice(-7);

  beforeAll(async () => {
    const a = await registerStaff(`81${suffix}`, 'Alice Operator', 'shuttle_operator');
    const b = await registerStaff(`82${suffix}`, 'Bob Operator', 'shuttle_operator');
    alice = { id: a.userId, token: a.accessToken };
    bob = { id: b.userId, token: b.accessToken };
    users.push(alice.id, bob.id);

    // Les lignes ont besoin de zones existantes pour leurs stops.
    zone1 = await prisma.zone.create({ data: { name: `Zone-A-${suffix}`, latitude: 14.6, longitude: -17.4, status: 'active' } });
    zone2 = await prisma.zone.create({ data: { name: `Zone-B-${suffix}`, latitude: 14.7, longitude: -17.3, status: 'active' } });
  });

  afterAll(async () => {
    await cleanupUsers(users);
    await prisma.zone.deleteMany({ where: { id: { in: [zone1.id, zone2.id] } } });
    await prisma.$disconnect();
  });

  test('RBAC : un client ne peut pas accéder à /shuttle-operator', async () => {
    const r = await registerStaff(`83${suffix}`, 'Carl Client', 'client');
    users.push(r.userId);
    const res = await request(app).get(`${base}/overview`).set(authHeader(r.accessToken));
    expect(res.status).toBe(403);
  });

  test('CRUD lignes : création + ownership isolée', async () => {
    const created = await request(app).post(`${base}/lines`).set(authHeader(alice.token)).send({
      operator: 'ddd',
      number: `A${suffix}`,
      direction: 'aller',
      name: 'Ligne Alice',
      origin: 'Dakar',
      destination: 'Pikine',
      stops: [
        { order: 1, zoneId: zone1.id, label: 'Terminus Dakar' },
        { order: 2, zoneId: zone2.id, label: 'Pikine' },
      ],
    });
    expect(created.status).toBe(201);
    const lineId = created.body.data.line.id;
    expect(created.body.data.line.stops).toHaveLength(2);

    // Bob ne doit voir ni lister ni modifier la ligne d'Alice.
    const bobList = await request(app).get(`${base}/lines`).set(authHeader(bob.token));
    expect(bobList.status).toBe(200);
    expect(bobList.body.data.lines).toHaveLength(0);

    const bobUpdate = await request(app).patch(`${base}/lines/${lineId}`).set(authHeader(bob.token)).send({ name: 'piraté' });
    expect(bobUpdate.status).toBe(404);

    const bobDelete = await request(app).delete(`${base}/lines/${lineId}`).set(authHeader(bob.token));
    expect(bobDelete.status).toBe(404);

    // Nettoyage : Alice supprime sa ligne.
    const del = await request(app).delete(`${base}/lines/${lineId}`).set(authHeader(alice.token));
    expect(del.status).toBe(200);
  });

  test('CRUD véhicules : plaque unique par opérateur, soft delete', async () => {
    const plate = `DK-TEST-${suffix}`;
    const created = await request(app).post(`${base}/vehicles`).set(authHeader(alice.token)).send({
      plateNumber: plate,
      model: 'Sprinter',
      type: 'minibus',
      capacity: 20,
    });
    expect(created.status).toBe(201);
    const vehicleId = created.body.data.vehicle.id;

    // Alice ne peut pas dupliquer la plaque dans sa propre flotte.
    const dup = await request(app).post(`${base}/vehicles`).set(authHeader(alice.token)).send({
      plateNumber: plate, model: 'Hiace', type: 'van', capacity: 15,
    });
    expect(dup.status).toBe(422);

    // Bob peut utiliser la même plaque (flottes séparées).
    const bobSame = await request(app).post(`${base}/vehicles`).set(authHeader(bob.token)).send({
      plateNumber: plate, model: 'Coaster', type: 'bus', capacity: 30,
    });
    expect(bobSame.status).toBe(201);

    // Soft delete : le véhicule retiré n'apparaît plus dans la liste.
    const del = await request(app).delete(`${base}/vehicles/${vehicleId}`).set(authHeader(alice.token));
    expect(del.status).toBe(200);
    const list = await request(app).get(`${base}/vehicles`).set(authHeader(alice.token));
    expect(list.body.data.vehicles.find((v) => v.id === vehicleId)).toBeUndefined();

    // Nettoyage côté Bob.
    await request(app).delete(`${base}/vehicles/${bobSame.body.data.vehicle.id}`).set(authHeader(bob.token));
  });

  test('CRUD horaires : rattachement ligne obligatoire + validation HH:MM', async () => {
    const line = await request(app).post(`${base}/lines`).set(authHeader(alice.token)).send({
      operator: 'aftu',
      number: `B${suffix}`,
      direction: 'retour',
      name: 'Ligne horaire',
      origin: 'Dakar',
      destination: 'Rufisque',
      stops: [
        { order: 1, zoneId: zone1.id, label: 'Dakar' },
        { order: 2, zoneId: zone2.id, label: 'Rufisque' },
      ],
    });
    const lineId = line.body.data.line.id;

    // Alice crée un horaire valide.
    const ok = await request(app).post(`${base}/schedules`).set(authHeader(alice.token)).send({
      transitLineId: lineId,
      daysOfWeek: [1, 2, 3, 4, 5],
      departureTime: '07:30',
    });
    expect(ok.status).toBe(201);

    // Format d'heure invalide.
    const badTime = await request(app).post(`${base}/schedules`).set(authHeader(alice.token)).send({
      transitLineId: lineId, daysOfWeek: [1], departureTime: '25:99',
    });
    expect(badTime.status).toBe(422);

    // Jour hors plage.
    const badDay = await request(app).post(`${base}/schedules`).set(authHeader(alice.token)).send({
      transitLineId: lineId, daysOfWeek: [8], departureTime: '09:00',
    });
    expect(badDay.status).toBe(422);

    // Bob ne peut pas rattacher d'horaire à la ligne d'Alice.
    const bobTry = await request(app).post(`${base}/schedules`).set(authHeader(bob.token)).send({
      transitLineId: lineId, daysOfWeek: [1], departureTime: '09:00',
    });
    expect(bobTry.status).toBe(404);

    // Nettoyage : supprimer la ligne supprime en cascade les horaires + stops.
    await request(app).delete(`${base}/lines/${lineId}`).set(authHeader(alice.token));
  });

  test('Overview renvoie les compteurs de l’opérateur seul', async () => {
    const res = await request(app).get(`${base}/overview`).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      lineCount: expect.any(Number),
      vehicleCount: expect.any(Number),
      availableVehicleCount: expect.any(Number),
      scheduleCount: expect.any(Number),
      activeScheduleCount: expect.any(Number),
    }));
  });
});
