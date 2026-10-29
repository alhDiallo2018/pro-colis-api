import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

test('les rafraîchissements ne consomment aucun quota global, la connexion reste protégée', async () => {
  // Une même IP peut représenter plusieurs mobiles derrière le réseau opérateur.
  for (let i = 0; i < 305; i++) {
    const res = await request(app).get('/api/v1/auth/google/config');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  }
  // Le corps invalide évite toute opération en BD, tout en traversant le limiteur.
  for (let i = 0; i < env.AUTH_RATE_LIMIT_MAX; i++) {
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(422);
  }
  const blocked = await request(app).post('/api/v1/auth/login').send({});
  expect(blocked.status).toBe(429);
  expect(blocked.body.error.code).toBe('RATE_LIMITED');
});
