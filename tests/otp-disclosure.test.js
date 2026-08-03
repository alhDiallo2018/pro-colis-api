import request from 'supertest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';

/**
 * Sans Brevo, l'API renvoyait le code a usage unique EN CLAIR dans la reponse
 * HTTP. En production, cela permet a n'importe qui de demander un code pour le
 * numero d'autrui et de le lire dans la reponse, sans jamais toucher au
 * telephone vise — une prise de controle de compte a distance.
 *
 * Ces tests verrouillent les deux moities de la regle : le confort de
 * developpement reste, la fuite en production disparait.
 *
 * La suite tourne avec NODE_ENV=test et sans cle Brevo : c'est exactement la
 * branche de repli, celle qui divulguait le code.
 */
describe('divulgation du code OTP', () => {
  const originalEnv = env.NODE_ENV;
  const suffix = String(Date.now()).slice(-6);

  // `sendOtp` refuse un second code pour le meme identifiant dans la minute :
  // chaque assertion a donc son propre numero.
  let seq = 0;
  const nextPhone = () => `+2217${suffix}${String(seq++).padStart(2, '0')}`;

  /** Compte reel : forgot-password et resend-verification exigent un user. */
  async function registerUser() {
    const phone = nextPhone();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Test OTP',
        phone,
        email: `otp${suffix}${seq}@test.local`,
        password: 'Motdepasse1!',
        role: 'client'
      });
    return { phone, ok: res.status === 201 };
  }

  afterEach(() => {
    env.NODE_ENV = originalEnv;
  });

  describe('hors production', () => {
    it('send-otp expose le code pour le developpement local', async () => {
      const res = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ phone: nextPhone(), purpose: 'verification' });

      expect(res.status).toBe(200);
      expect(res.body.code).toMatch(/^\d{6}$/);
    });

    it('forgot-password expose le code pour le developpement local', async () => {
      const user = await registerUser();
      expect(user.ok).toBe(true);

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: user.phone });

      expect(res.status).toBe(200);
      expect(res.body.code).toMatch(/^\d{6}$/);
    });
  });

  describe('en production', () => {
    beforeEach(() => {
      env.NODE_ENV = 'production';
    });

    it('send-otp ne divulgue jamais le code et repond 503', async () => {
      const res = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ phone: nextPhone(), purpose: 'verification' });

      // Un faux succes laisserait l'utilisateur devant un ecran de saisie
      // qu'aucun code ne viendra remplir.
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('OTP_DELIVERY_UNAVAILABLE');
      // Ni dans les donnees, ni glisse dans le message.
      expect(JSON.stringify(res.body)).not.toMatch(/\b\d{6}\b/);
    });

    it('forgot-password ne divulgue jamais le code', async () => {
      // Le compte est cree hors production, sinon l'inscription elle-meme
      // passerait par la meme regle de livraison.
      env.NODE_ENV = originalEnv;
      const user = await registerUser();
      expect(user.ok).toBe(true);
      env.NODE_ENV = 'production';

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: user.phone });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('OTP_DELIVERY_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/\b\d{6}\b/);
    });

    it('resend-verification ne divulgue jamais le code', async () => {
      env.NODE_ENV = originalEnv;
      const user = await registerUser();
      expect(user.ok).toBe(true);
      env.NODE_ENV = 'production';

      const res = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ identifier: user.phone });

      // Un compte deja verifie repond 4xx : dans tous les cas, aucun code ne
      // doit apparaitre dans la reponse.
      expect(JSON.stringify(res.body)).not.toMatch(/\b\d{6}\b/);
      expect(res.body.code).toBeUndefined();
    });
  });
});
