/**
 * Tests de l'endpoint `GET /drivers/backhaul-matches/:advertisementId`.
 *
 * On couvre :
 *  1. 401 sans auth.
 *  2. 403 pour un client (ni driver ni shuttle_operator).
 *  3. 403 pour un driver tiers (annonce d'un autre driver).
 *  4. 404 pour un advertisementId inconnu.
 *  5. 200 : 3 colis, 2 compatibles (sur-route, sous-capacité) triés par
 *     score desc + 1 off-route listé dans `rejected` avec la raison
 *     `off_route`.
 */
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { authHeader, cleanupUsers, registerPublic } from './helpers.js';

const base = '/api/v1/drivers';

describe('GET /drivers/backhaul-matches/:advertisementId', () => {
  const suffix = Date.now().toString().slice(-7);
  const userIds = [];
  const zoneIds = [];
  const parcelIds = [];

  let driver;
  let otherDriver;
  let client;
  let dakarZone;
  let thiesZone;
  let kaolackZone; // zone très au large pour obtenir un off_route
  let advertisementId;

  beforeAll(async () => {
    // Trois utilisateurs : le driver propriétaire, un driver tiers, un client.
    const d1 = await registerPublic(`90${suffix}`, 'Backhaul Driver', 'driver');
    expect(d1.status).toBe(201);
    driver = { id: d1.body.user.id, token: d1.body.accessToken };
    userIds.push(driver.id);

    const d2 = await registerPublic(`91${suffix}`, 'Other Driver', 'driver');
    expect(d2.status).toBe(201);
    otherDriver = { id: d2.body.user.id, token: d2.body.accessToken };
    userIds.push(otherDriver.id);

    const c1 = await registerPublic(`92${suffix}`, 'Backhaul Client', 'client');
    expect(c1.status).toBe(201);
    client = { id: c1.body.user.id, token: c1.body.accessToken };
    userIds.push(client.id);

    // Trajet Dakar → Thiès. Kaolack est bien hors route (~150 km de la droite).
    dakarZone = await prisma.zone.create({
      data: {
        name: `Backhaul Dakar ${suffix}`,
        placeId: `backhaul-dakar-${suffix}`,
        latitude: 14.6928,
        longitude: -17.4467,
        radiusKm: 5
      }
    });
    thiesZone = await prisma.zone.create({
      data: {
        name: `Backhaul Thies ${suffix}`,
        placeId: `backhaul-thies-${suffix}`,
        latitude: 14.7886,
        longitude: -16.9256,
        radiusKm: 5
      }
    });
    kaolackZone = await prisma.zone.create({
      data: {
        name: `Backhaul Kaolack ${suffix}`,
        placeId: `backhaul-kaolack-${suffix}`,
        latitude: 14.1562,
        longitude: -16.0756,
        radiusKm: 5
      }
    });
    zoneIds.push(dakarZone.id, thiesZone.id, kaolackZone.id);

    // Zones intermédiaires sur la droite Dakar-Thiès (pour les colis "proche").
    const midZoneA = await prisma.zone.create({
      data: {
        name: `Backhaul Mid A ${suffix}`,
        placeId: `backhaul-mida-${suffix}`,
        latitude: 14.74,
        longitude: -17.18, // ~mi-trajet, quasi sur la droite
        radiusKm: 2
      }
    });
    const midZoneB = await prisma.zone.create({
      data: {
        name: `Backhaul Mid B ${suffix}`,
        placeId: `backhaul-midb-${suffix}`,
        latitude: 14.76,
        longitude: -17.05, // proche mais légèrement décalé
        radiusKm: 2
      }
    });
    zoneIds.push(midZoneA.id, midZoneB.id);

    // Annonce du driver propriétaire : capacité 20 kg, Dakar → Thiès, ouverte.
    const ad = await prisma.advertisement.create({
      data: {
        driverId: driver.id,
        departureZoneId: dakarZone.id,
        arrivalZoneId: thiesZone.id,
        departureCity: 'Dakar',
        arrivalCity: 'Thies',
        availableWeight: 20,
        status: 'open'
      }
    });
    advertisementId = ad.id;

    // Colis 1 : pile sur la route, poids OK → compatible (score plus fort).
    const p1 = await prisma.parcel.create({
      data: {
        senderId: client.id,
        senderName: 'Sender One',
        senderPhone: `7781${suffix.slice(-4)}`,
        receiverName: 'Receiver One',
        receiverPhone: `7791${suffix.slice(-4)}`,
        description: 'Colis sur-route proche',
        weight: 4,
        trackingNumber: `BH1-${suffix}`,
        status: 'pending',
        departureZoneId: midZoneA.id,
        arrivalZoneId: thiesZone.id
      }
    });
    parcelIds.push(p1.id);

    // Colis 2 : sur la route (léger détour), poids OK → compatible.
    const p2 = await prisma.parcel.create({
      data: {
        senderId: client.id,
        senderName: 'Sender Two',
        senderPhone: `7782${suffix.slice(-4)}`,
        receiverName: 'Receiver Two',
        receiverPhone: `7792${suffix.slice(-4)}`,
        description: 'Colis sur-route detour',
        weight: 6,
        trackingNumber: `BH2-${suffix}`,
        status: 'free',
        departureZoneId: midZoneB.id,
        arrivalZoneId: thiesZone.id
      }
    });
    parcelIds.push(p2.id);

    // Colis 3 : hors route (Kaolack très au large) → rejeté.
    const p3 = await prisma.parcel.create({
      data: {
        senderId: client.id,
        senderName: 'Sender Three',
        senderPhone: `7783${suffix.slice(-4)}`,
        receiverName: 'Receiver Three',
        receiverPhone: `7793${suffix.slice(-4)}`,
        description: 'Colis hors route',
        weight: 3,
        trackingNumber: `BH3-${suffix}`,
        status: 'pending',
        departureZoneId: kaolackZone.id,
        arrivalZoneId: thiesZone.id
      }
    });
    parcelIds.push(p3.id);
  });

  afterAll(async () => {
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    if (advertisementId) {
      await prisma.advertisementOffer.deleteMany({ where: { advertisementId } });
      await prisma.advertisement.deleteMany({ where: { id: advertisementId } });
    }
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await cleanupUsers(userIds);
    await prisma.$disconnect();
  });

  test('401 sans auth', async () => {
    const res = await request(app).get(`${base}/backhaul-matches/${advertisementId}`);
    expect(res.status).toBe(401);
  });

  test('403 pour un client (ni driver ni shuttle_operator)', async () => {
    const res = await request(app)
      .get(`${base}/backhaul-matches/${advertisementId}`)
      .set(authHeader(client.token));
    expect(res.status).toBe(403);
  });

  test('403 pour un driver tiers (annonce d\'un autre driver)', async () => {
    const res = await request(app)
      .get(`${base}/backhaul-matches/${advertisementId}`)
      .set(authHeader(otherDriver.token));
    expect(res.status).toBe(403);
  });

  test('404 pour advertisementId inconnu', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .get(`${base}/backhaul-matches/${unknown}`)
      .set(authHeader(driver.token));
    expect(res.status).toBe(404);
  });

  test('200 — 2 compatibles triés par score + 1 off-route dans rejected', async () => {
    const res = await request(app)
      .get(`${base}/backhaul-matches/${advertisementId}`)
      .set(authHeader(driver.token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { matches, rejected } = res.body.data;
    expect(Array.isArray(matches)).toBe(true);
    expect(Array.isArray(rejected)).toBe(true);

    // 2 compatibles.
    expect(matches).toHaveLength(2);
    // Triés par score décroissant.
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
    // Les ids des colis compatibles sont ceux des colis sur-route.
    const compatibleIds = matches.map((m) => m.id).sort();
    expect(compatibleIds).toEqual(parcelIds.slice(0, 2).sort());

    // Le colis Kaolack figure parmi les rejetés avec la raison off_route.
    const offRoute = rejected.find((r) => r.id === parcelIds[2]);
    expect(offRoute).toBeDefined();
    expect(offRoute.reasons).toContain('off_route');
  });
});
