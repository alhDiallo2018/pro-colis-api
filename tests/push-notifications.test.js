import { buildFcmMessage, isPushConfigured, resetPushCache, sendPushToUser } from '../src/utils/push.js';

/**
 * La charge FCM est fabriquee a la main (pas de `firebase-admin`) : ces tests
 * epinglent le contrat de l'API HTTP v1, ou une erreur de forme se traduit par
 * un 400 silencieux et une notification jamais recue.
 */
describe('charge utile des notifications push', () => {
  beforeEach(() => {
    resetPushCache();
  });

  test('desactivee tant qu\'aucun compte de service n\'est configure', async () => {
    // Ni FIREBASE_SERVICE_ACCOUNT_PATH ni FIREBASE_SERVICE_ACCOUNT_JSON dans
    // l'environnement de test : l'API doit continuer sans push, pas echouer.
    expect(isPushConfigured()).toBe(false);
    await expect(sendPushToUser('un-utilisateur', { title: 'x', body: 'y' })).resolves.toBe(0);
  });

  test('n\'envoie rien sans destinataire', async () => {
    await expect(sendPushToUser(null, { title: 'x', body: 'y' })).resolves.toBe(0);
  });

  test('place le badge sur les trois canaux qui savent l\'afficher', () => {
    const { message } = buildFcmMessage({
      token: 'jeton-appareil',
      title: 'Nouvelle offre',
      body: 'Customer Test propose 4 800 FCFA',
      badge: 7,
      data: { type: 'advertisement_offer' }
    });

    // iOS badge l'icone lui-meme depuis `aps`, application fermee comprise.
    expect(message.apns.payload.aps.badge).toBe(7);
    // Android : les launchers compatibles lisent `notification_count`.
    expect(message.android.notification.notification_count).toBe(7);
    // Repli applicatif : le handler Dart pose le badge depuis `data`.
    expect(message.data.badge).toBe('7');
    expect(message.token).toBe('jeton-appareil');
    expect(message.notification).toEqual({
      title: 'Nouvelle offre',
      body: 'Customer Test propose 4 800 FCFA'
    });
  });

  test('n\'expose que des chaines dans `data`, seule forme acceptee par FCM v1', () => {
    const { message } = buildFcmMessage({
      token: 'jeton',
      title: 't',
      body: 'b',
      badge: 0,
      data: {
        type: 'parcel_status',
        parcelId: 'abc',
        bidId: null,
        attempt: 2,
        meta: { nested: true }
      }
    });

    for (const value of Object.values(message.data)) {
      expect(typeof value).toBe('string');
    }
    // Une cle nulle deviendrait la chaine "null" cote mobile, prise pour un
    // identifiant valide : elle est retiree.
    expect(message.data).not.toHaveProperty('bidId');
    expect(message.data.attempt).toBe('2');
    expect(message.data.meta).toBe('{"nested":true}');
  });

  test('remonte la priorite pour les notifications urgentes', () => {
    const normale = buildFcmMessage({ token: 't', title: 'a', body: 'b', badge: 1 }).message;
    const haute = buildFcmMessage({
      token: 't',
      title: 'a',
      body: 'b',
      badge: 1,
      priority: 'high'
    }).message;

    expect(normale.android.priority).toBe('NORMAL');
    expect(normale.apns.headers['apns-priority']).toBe('5');
    expect(haute.android.priority).toBe('HIGH');
    expect(haute.apns.headers['apns-priority']).toBe('10');
  });
});
