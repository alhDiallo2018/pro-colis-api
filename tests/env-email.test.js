import { spawnSync } from 'node:child_process';

describe('configuration optionnelle Brevo', () => {
  const parse = (email) => spawnSync(process.execPath,
    ['--input-type=module', '-e', 'await import("./src/config/env.js")'], {
      cwd: process.cwd(), encoding: 'utf8',
      // Un environnement isole empeche ce test de lire les secrets du .env local.
      env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost/test', JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        ...(email === undefined ? {} : { BREVO_SENDER_EMAIL: email }) }
    });

  test.each([undefined, '', 'notifications@example.com'])('accepte %s', (email) => {
    expect(parse(email).status).toBe(0);
  });

  test('refuse une adresse renseignee mais invalide', () => {
    const result = parse('adresse-invalide');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('BREVO_SENDER_EMAIL');
  });
});
