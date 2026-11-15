import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

const previous = { ...env };

afterEach(() => {
  Object.assign(env, previous);
});

describe('mobileVersionMiddleware', () => {
  test('ne bloque jamais quand la politique est désactivée', async () => {
    env.MOBILE_ANDROID_UPDATE_ENABLED = false;
    env.MOBILE_ANDROID_MIN_VERSION_CODE = 99;
    const res = await request(app)
      .get('/api/v1/health')
      .set('X-App-Platform', 'android')
      .set('X-App-Build', '1');
    expect(res.status).not.toBe(426);
  });

  test('ne bloque jamais la route de politique de mise à jour', async () => {
    env.MOBILE_ANDROID_UPDATE_ENABLED = true;
    env.MOBILE_ANDROID_MIN_VERSION_CODE = 99;
    const res = await request(app)
      .get('/api/v1/public/mobile-update')
      .set('X-App-Platform', 'android')
      .set('X-App-Build', '1');
    expect(res.status).toBe(200);
  });

  test('ne bloque jamais les clients web/sans plateforme', async () => {
    env.MOBILE_ANDROID_UPDATE_ENABLED = true;
    env.MOBILE_ANDROID_MIN_VERSION_CODE = 99;
    const webRes = await request(app)
      .get('/api/v1/public/vehicle-types')
      .set('X-App-Platform', 'web')
      .set('X-App-Build', '1');
    expect(webRes.status).not.toBe(426);
    const noHeader = await request(app).get('/api/v1/public/vehicle-types');
    expect(noHeader.status).not.toBe(426);
  });

  test('ne bloque pas un build mobile >= minVersionCode', async () => {
    env.MOBILE_ANDROID_UPDATE_ENABLED = true;
    env.MOBILE_ANDROID_MIN_VERSION_CODE = 10;
    const res = await request(app)
      .get('/api/v1/public/vehicle-types')
      .set('X-App-Platform', 'android')
      .set('X-App-Build', '17');
    expect(res.status).not.toBe(426);
  });

  test('refuse un build mobile obsolète avec UPDATE_REQUIRED', async () => {
    env.MOBILE_ANDROID_UPDATE_ENABLED = true;
    env.MOBILE_ANDROID_MIN_VERSION_CODE = 20;
    const res = await request(app)
      .get('/api/v1/public/vehicle-types')
      .set('X-App-Platform', 'android')
      .set('X-App-Build', '10');
    expect(res.status).toBe(426);
    expect(res.body).toMatchObject({
      success: false,
      code: 'UPDATE_REQUIRED'
    });
    expect(typeof res.body.updateUrl).toBe('string');
  });

  test('un header X-App-Build invalide ne bloque pas (autoriser le passage)', async () => {
    env.MOBILE_ANDROID_UPDATE_ENABLED = true;
    env.MOBILE_ANDROID_MIN_VERSION_CODE = 99;
    const res = await request(app)
      .get('/api/v1/public/vehicle-types')
      .set('X-App-Platform', 'android')
      .set('X-App-Build', 'not-a-number');
    expect(res.status).not.toBe(426);
  });
});
