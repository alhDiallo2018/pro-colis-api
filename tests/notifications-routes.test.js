import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * `DELETE /notifications/all` doit rester enregistree AVANT
 * `DELETE /notifications/:notificationId`.
 *
 * Express resout les routes dans l'ordre de declaration : si le parametre passe
 * en premier, le mot « all » est pris pour un identifiant et part tel quel dans
 * une requete attendant un UUID. La purge devient alors une route morte, sans
 * qu'aucun test ne s'en apercoive. Ce fichier epingle l'ordre.
 */
describe('routes de notifications', () => {
  const suffix = String(Date.now()).slice(-6);
  let token;
  let userId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Test Notifications',
        phone: `+2216${suffix}`,
        email: `notif${suffix}@test.local`,
        password: 'Motdepasse1!',
        role: 'client'
      });
    token = res.body.accessToken;
    userId = res.body.user.id;
  }, 20000);

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function seedNotifications(count) {
    await prisma.notification.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        userId,
        type: 'message',
        title: `Notification ${i}`,
        body: 'Contenu de test'
      }))
    });
  }

  it('purge toutes les notifications de l utilisateur', async () => {
    await seedNotifications(3);

    const res = await request(app).delete('/api/v1/notifications/all').set(auth());

    // Un 404 ici signifie que « all » a ete capte comme :notificationId.
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);

    const remaining = await prisma.notification.count({ where: { userId } });
    expect(remaining).toBe(0);
  });

  it('ne touche pas aux notifications des autres comptes', async () => {
    const other = await request(app)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Autre Compte',
        phone: `+2215${suffix}`,
        email: `autre${suffix}@test.local`,
        password: 'Motdepasse1!',
        role: 'client'
      });

    await prisma.notification.create({
      data: {
        userId: other.body.user.id,
        type: 'message',
        title: 'A conserver',
        body: 'Contenu de test'
      }
    });
    await seedNotifications(2);

    await request(app).delete('/api/v1/notifications/all').set(auth());

    const survivor = await prisma.notification.count({
      where: { userId: other.body.user.id }
    });
    expect(survivor).toBe(1);
  }, 20000);

  it('supprime encore une notification par identifiant', async () => {
    // La correction d'ordre ne doit pas avoir eteint la route parametree.
    const notification = await prisma.notification.create({
      data: { userId, type: 'message', title: 'Unique', body: 'Contenu' }
    });

    const res = await request(app)
      .delete(`/api/v1/notifications/${notification.id}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(await prisma.notification.count({ where: { id: notification.id } })).toBe(0);
  });

  it('exige une authentification', async () => {
    const res = await request(app).delete('/api/v1/notifications/all');
    expect(res.status).toBe(401);
  });
});
