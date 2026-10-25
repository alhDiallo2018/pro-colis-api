import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { appUpdateEnvSchema, publicAndroidUpdatePolicy } from '../src/config/app-update.js';

describe('Politique de mise a jour Android', () => {
  test('est desactivee par defaut et ne publie aucun secret', () => {
    const config = appUpdateEnvSchema.parse({});
    const policy = publicAndroidUpdatePolicy({ ...config, JWT_ACCESS_SECRET: 'secret' });
    expect(policy.enabled).toBe(false);
    expect(Object.keys(policy).sort()).toEqual([
      'enabled', 'latestVersion', 'latestVersionCode', 'minVersionCode',
      'releaseNotes', 'remindAfterHours', 'updateUrl'
    ]);
  });

  test.each([
    { MOBILE_ANDROID_UPDATE_ENABLED: 'yes' },
    { MOBILE_ANDROID_MIN_VERSION_CODE: 7, MOBILE_ANDROID_LATEST_VERSION_CODE: 6 },
    { MOBILE_ANDROID_LATEST_VERSION: '' },
    { MOBILE_ANDROID_LATEST_VERSION_CODE: -1 },
    { MOBILE_ANDROID_LATEST_VERSION_CODE: 2.5 },
    { MOBILE_ANDROID_LATEST_VERSION_CODE: 2100000001 },
    { MOBILE_ANDROID_UPDATE_ENABLED: 'true', MOBILE_ANDROID_LATEST_VERSION_CODE: 0 },
    { MOBILE_ANDROID_REMIND_AFTER_HOURS: 0 },
    { MOBILE_ANDROID_REMIND_AFTER_HOURS: 721 },
    { MOBILE_ANDROID_UPDATE_URL: 'http://example.com/app' },
    { MOBILE_ANDROID_UPDATE_URL: 'javascript:alert(1)' },
    { MOBILE_ANDROID_UPDATE_URL: 'invalide' },
    { MOBILE_ANDROID_UPDATE_URL: 'https://user:password@example.com/app' },
    { MOBILE_ANDROID_RELEASE_NOTES_FR: 'x'.repeat(4001) }
  ])('rejette une configuration incoherente %j', config => {
    expect(appUpdateEnvSchema.safeParse(config).success).toBe(false);
  });

  test('lit les cles .env demandées et les notes dans les deux langues', () => {
    const config = appUpdateEnvSchema.parse({
      MOBILE_ANDROID_UPDATE_ENABLED: 'true',
      MOBILE_ANDROID_LATEST_VERSION: '1.0.13',
      MOBILE_ANDROID_LATEST_VERSION_CODE: '46',
      MOBILE_ANDROID_MIN_VERSION_CODE: '40',
      MOBILE_ANDROID_RELEASE_NOTES_FR: 'Corrections de la carte.',
      MOBILE_ANDROID_RELEASE_NOTES_EN: 'Map fixes.',
      MOBILE_ANDROID_REMIND_AFTER_HOURS: '48'
    });
    expect(publicAndroidUpdatePolicy(config)).toMatchObject({
      enabled: true, latestVersion: '1.0.13', latestVersionCode: 46, minVersionCode: 40,
      releaseNotes: { fr: 'Corrections de la carte.', en: 'Map fixes.' }, remindAfterHours: 48
    });
    expect(appUpdateEnvSchema.safeParse({
      MOBILE_ANDROID_LATEST_VERSION_CODE: 46, MOBILE_ANDROID_MIN_VERSION_CODE: 46
    }).success).toBe(true);
  });

  test.each([null, 'Bearer expired-or-invalid'])('est publique meme avec un ancien token (%s)', async token => {
    const req = request(app).get('/api/v1/public/mobile-update');
    if (token) req.set('Authorization', token);
    const response = await req;
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.android).toEqual(publicAndroidUpdatePolicy(env));
    expect(response.body.success).toBe(true);
  });

  test('conserve l’alias de la premiere integration', async () => {
    const response = await request(app).get('/api/v1/public/app-update');
    expect(response.status).toBe(200);
    expect(response.body.android).toEqual(publicAndroidUpdatePolicy(env));
  });
});
