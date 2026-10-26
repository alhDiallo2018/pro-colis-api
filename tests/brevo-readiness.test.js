import { jest } from '@jest/globals';
import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';
import { invalidateBrevoConfigCache, isBrevoConfigured, isBrevoConfiguredAsync } from '../src/utils/brevo.js';

const originalKey = env.BREVO_API_KEY;
beforeEach(() => {
  env.BREVO_API_KEY = '';
  invalidateBrevoConfigCache();
});
afterEach(() => {
  env.BREVO_API_KEY = originalKey;
  jest.restoreAllMocks();
  invalidateBrevoConfigCache();
});
afterAll(async () => { await prisma.$disconnect(); });

test('une cle stockee en BD est reconnue au premier appel apres redemarrage', async () => {
  let resolveConfig;
  jest.spyOn(prisma.systemConfig, 'findUnique').mockReturnValue(new Promise(resolve => { resolveConfig = resolve; }));
  // Le snapshot historique demarre la lecture mais n'attend pas son resultat.
  expect(isBrevoConfigured()).toBe(false);
  const ready = isBrevoConfiguredAsync();
  resolveConfig({ value: { apiKey: 'test-only-no-network' } });
  expect(await ready).toBe(true);
});

test('reste non configure si la BD et l environnement ne contiennent pas de cle', async () => {
  jest.spyOn(prisma.systemConfig, 'findUnique').mockResolvedValue(null);
  expect(await isBrevoConfiguredAsync()).toBe(false);
});

test('conserve le repli environnement si la BD est indisponible', async () => {
  env.BREVO_API_KEY = 'test-only-no-network';
  jest.spyOn(prisma.systemConfig, 'findUnique').mockRejectedValue(new Error('DB unavailable'));
  expect(await isBrevoConfiguredAsync()).toBe(true);
});
