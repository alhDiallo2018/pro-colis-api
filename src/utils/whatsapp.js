/**
 * Notifications WhatsApp Business via Meta Cloud API.
 *
 * Scaffold prêt-à-brancher : si les variables d'env ne sont pas renseignées,
 * les fonctions retournent `null` et logguent un warning — l'appli reste
 * fonctionnelle (dégradation gracieuse, comme `brevo.js`). Les notifications
 * FCM et Brevo continuent d'opérer en parallèle.
 *
 * Variables d'env attendues (quand prêtes à l'emploi) :
 *  - META_WHATSAPP_ACCESS_TOKEN
 *  - META_WHATSAPP_PHONE_NUMBER_ID
 *  - META_WHATSAPP_API_VERSION  (optionnel, défaut v21.0)
 *
 * Templates Meta à faire approuver (24-72h) :
 *  - procolis_parcel_picked_up
 *  - procolis_parcel_in_transit
 *  - procolis_parcel_out_for_delivery
 *  - procolis_parcel_delivered
 *  - procolis_parcel_anomaly
 */

import { logger } from '../config/logger.js';
import {
  recordWhatsAppFailure,
  recordWhatsAppSend
} from './whatsapp-journal.js';

const DEFAULT_API_VERSION = 'v21.0';

/**
 * Est-ce que le canal WhatsApp est configuré et prêt à envoyer ? Permet aux
 * callers de savoir s'il faut tenter l'envoi (évite des round-trips HTTP
 * inutiles vers Meta qui échoueraient en 401).
 */
export function isWhatsAppConfigured() {
  return (
    typeof process.env.META_WHATSAPP_ACCESS_TOKEN === 'string' &&
    process.env.META_WHATSAPP_ACCESS_TOKEN.length > 0 &&
    typeof process.env.META_WHATSAPP_PHONE_NUMBER_ID === 'string' &&
    process.env.META_WHATSAPP_PHONE_NUMBER_ID.length > 0
  );
}

/**
 * Normalise un numéro de téléphone au format E.164 attendu par Meta
 * (sans `+`, en entier numérique). Les séparateurs, espaces et `+`
 * sont retirés. Aucune validation stricte : Meta renvoie 400 si invalide.
 */
function toMetaPhone(phone) {
  if (typeof phone !== 'string') return null;
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length >= 8 ? digits : null;
}

/**
 * Construit le body d'une notification « template » Meta Cloud.
 * La structure est documentée : https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 * @param {string} to  Numéro E.164 (sans `+`)
 * @param {string} templateName  Nom exact du template approuvé par Meta
 * @param {string} languageCode  Ex: 'fr'
 * @param {Array<string|number>} bodyParams  Valeurs des placeholders {{1}}, {{2}}, …
 */
export function buildTemplateMessage({
  to,
  templateName,
  languageCode = 'fr',
  bodyParams = []
}) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [
            {
              type: 'body',
              parameters: bodyParams.map((p) => ({
                type: 'text',
                text: String(p)
              }))
            }
          ]
        : []
    }
  };
}

/**
 * Envoie un message template à un numéro. Dégradation gracieuse :
 *  - Si pas configuré → log warn + return null.
 *  - Si numéro invalide → log warn + return null.
 *  - Si Meta répond en erreur → log warn + return null.
 * JAMAIS d'exception vers le caller : WhatsApp ne doit pas casser un flux
 * métier (ex. création de colis) si Meta est indisponible.
 */
export async function sendWhatsAppTemplate({
  phone,
  templateName,
  languageCode = 'fr',
  bodyParams = [],
  parcelId = null
}) {
  if (!isWhatsAppConfigured()) {
    logger.warn(
      { component: 'whatsapp', templateName },
      'WhatsApp non configuré — notification ignorée'
    );
    return null;
  }

  const to = toMetaPhone(phone);
  if (!to) {
    logger.warn(
      { component: 'whatsapp', phone, templateName },
      'Numéro WhatsApp invalide — notification ignorée'
    );
    await recordWhatsAppFailure({
      phone: phone ?? '',
      templateName,
      parcelId,
      reason: 'invalid_phone'
    });
    return null;
  }

  const apiVersion = process.env.META_WHATSAPP_API_VERSION || DEFAULT_API_VERSION;
  const url = `https://graph.facebook.com/${apiVersion}/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = buildTemplateMessage({ to, templateName, languageCode, bodyParams });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(
        {
          component: 'whatsapp',
          templateName,
          status: response.status,
          body: text.slice(0, 500)
        },
        'Meta API a rejeté la notification WhatsApp'
      );
      await recordWhatsAppFailure({
        phone: to,
        templateName,
        parcelId,
        reason: `http_${response.status}`
      });
      return null;
    }
    const result = await response.json();
    // Journalise l'envoi : alimente les métriques pilote et prépare
    // la réception du callback Meta (`messageId` récupéré ici).
    await recordWhatsAppSend(result, { phone: to, templateName, parcelId });
    return result;
  } catch (error) {
    logger.warn(
      {
        component: 'whatsapp',
        templateName,
        error: error.message
      },
      "Envoi WhatsApp impossible — réseau ou timeout"
    );
    await recordWhatsAppFailure({
      phone: to,
      templateName,
      parcelId,
      reason: error.message || 'network_error'
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers métier : notifications d'événements colis prêts à brancher
// ─────────────────────────────────────────────────────────────────────

/**
 * Envoie la notification « votre colis est en route » au destinataire.
 * Appelable à chaque changement de statut pertinent, en parallèle de FCM.
 *
 * @param {object} args
 * @param {string} args.phone  Numéro du destinataire ou de l'expéditeur
 * @param {string} args.trackingNumber
 * @param {string} [args.recipientName]  Nom en entête (si template le prévoit)
 */
export async function sendParcelStatusWhatsApp({
  phone,
  trackingNumber,
  status,
  recipientName,
  parcelId = null
}) {
  const templateByStatus = {
    picked_up: 'procolis_parcel_picked_up',
    in_transit: 'procolis_parcel_in_transit',
    out_for_delivery: 'procolis_parcel_out_for_delivery',
    delivered: 'procolis_parcel_delivered'
  };
  const templateName = templateByStatus[status];
  if (!templateName) {
    logger.warn(
      { component: 'whatsapp', status },
      "Statut sans template WhatsApp — notification ignorée"
    );
    return null;
  }
  return sendWhatsAppTemplate({
    phone,
    templateName,
    bodyParams: [recipientName ?? 'Bonjour', trackingNumber],
    parcelId
  });
}

/**
 * Notification d'anomalie trajet (prolongée > 15 min, écart > 2 km, etc.).
 * Alerte destinée au support client, pas au destinataire final.
 */
export async function sendAnomalyAlertWhatsApp({
  phone,
  trackingNumber,
  anomalyType,
  parcelId = null
}) {
  return sendWhatsAppTemplate({
    phone,
    templateName: 'procolis_parcel_anomaly',
    bodyParams: [trackingNumber, anomalyType],
    parcelId
  });
}
