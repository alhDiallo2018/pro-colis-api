import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

const realKey = env.GOOGLE_MAPS_API_KEY;
let fetchMock;
beforeEach(() => {
  env.GOOGLE_MAPS_API_KEY = 'test-server-key';
  fetchMock = jest.spyOn(globalThis, 'fetch');
});
afterEach(() => { jest.restoreAllMocks(); env.GOOGLE_MAPS_API_KEY = realKey; });
const respond = body => fetchMock.mockResolvedValue({ ok: true, json: async () => body });

test('recherche mondiale sans restriction pays, type ou rayon', async () => {
  respond({ suggestions: [{ placePrediction: { placeId: 'tokyo', text: { text: 'Shibuya, Tokyo, Japon' },
    structuredFormat: { mainText: { text: 'Shibuya' }, secondaryText: { text: 'Tokyo, Japon' } } } }] });
  const res = await request(app).get('/api/v1/public/places/autocomplete').set('Connection', 'close').query({ input: 'Tokyo', sessionToken: 'session-1' });
  expect(res.status).toBe(200);
  expect(res.body.data[0]).toMatchObject({ place_id: 'tokyo', structured_formatting: { main_text: 'Shibuya' } });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toEqual({ input: 'Tokyo', languageCode: 'fr', sessionToken: 'session-1' });
  expect(JSON.stringify(res.body)).not.toContain('test-server-key');
});

test('détails compatibles avec les deux clients et jeton de session conservé', async () => {
  respond({ id: 'tokyo', displayName: { text: 'Shibuya' }, formattedAddress: 'Tokyo, Japon',
    location: { latitude: 35.66, longitude: 139.7 },
    addressComponents: [{ longText: 'Japon', shortText: 'JP', types: ['country'] }] });
  const res = await request(app).get('/api/v1/public/places/details').set('Connection', 'close').query({ placeId: 'tokyo', sessionToken: 'session-1' });
  expect(res.status).toBe(200);
  expect(res.body.data.geometry.location).toEqual({ lat: 35.66, lng: 139.7 });
  expect(res.body.data.address_components[0].long_name).toBe('Japon');
  expect(fetchMock.mock.calls[0][0].searchParams.get('sessionToken')).toBe('session-1');
});

test('géocodage inverse conserve exactement le point touché', async () => {
  respond({ status: 'OK', results: [{ place_id: 'street', formatted_address: 'Une rue', geometry: { location: { lat: 14, lng: -17 } } }] });
  const res = await request(app).get('/api/v1/public/places/reverse').set('Connection', 'close').query({ latitude: 14.7123456, longitude: -17.4123456 });
  expect(res.status).toBe(200);
  expect(res.body.data.geometry.location).toEqual({ lat: 14.7123456, lng: -17.4123456 });
});

test.each([{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: '', longitude: 0 }, { latitude: 'NaN', longitude: 0 }])('refuse les coordonnées invalides %j sans appel Google', async query => {
  expect((await request(app).get('/api/v1/public/places/reverse').set('Connection', 'close').query(query)).status).toBe(422);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('aucun résultat reste distinct d’une indisponibilité Google', async () => {
  respond({ suggestions: [] });
  expect((await request(app).get('/api/v1/public/places/autocomplete?input=Inconnu')).body.data).toEqual([]);
  fetchMock.mockRejectedValue(new Error('URL contenant test-server-key'));
  const res = await request(app).get('/api/v1/public/places/autocomplete?input=Paris');
  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe('PLACES_UNAVAILABLE');
  expect(JSON.stringify(res.body)).not.toContain('test-server-key');
});

test('clé absente produit une erreur explicite sans appel sortant', async () => {
  env.GOOGLE_MAPS_API_KEY = '';
  const res = await request(app).get('/api/v1/public/places/autocomplete?input=Dakar');
  expect(res.status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
});
