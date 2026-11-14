/**
 * Connecteur Shopify — webhook entrant signé HMAC-SHA256.
 *
 * Shopify signe chaque webhook avec le secret configuré côté boutique.
 * On vérifie `X-Shopify-Hmac-Sha256` en base64 contre le body brut avant
 * d'accepter l'événement. Sans signature valide → 401.
 *
 * Événements supportés en V1 :
 *   - `orders/create`         → crée un `Parcel` en statut `pending`.
 *   - `fulfillments/create`   → met à jour le `trackingNumber` si fourni.
 *
 * Mapping : les colis Shopify n'ont pas de chauffeur. Le `senderId` est pris
 * dans la config partenaire (`apiKeys.business.<slug>.shopifySenderId`).
 * En V2, résolution par domaine de boutique.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../../config/logger.js';

const CONFIG_PREFIX = 'apiKeys.business.';

export function verifyShopifyHmac({ rawBody, headerHmac, secret }) {
  if (!rawBody || !headerHmac || !secret) return false;
  const expected = createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
    .digest('base64');
  if (expected.length !== headerHmac.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(headerHmac));
  } catch {
    return false;
  }
}

/**
 * Convertit un order Shopify (JSON brut) en données de Parcel compatibles
 * avec le modèle Prisma. Validation minimale : les champs manquants côté
 * client sont remplacés par des valeurs par défaut sûres (jamais d'exception).
 */
export function orderToParcelData(order, { senderId, defaultWeightKg = 1 } = {}) {
  if (!order || typeof order !== 'object') return null;
  const shippingAddress = order.shipping_address || order.shippingAddress || {};
  const customer = order.customer || {};
  const lineItems = Array.isArray(order.line_items ?? order.lineItems)
    ? (order.line_items ?? order.lineItems)
    : [];

  const description = lineItems
    .map((it) => `${it.quantity ?? 1}× ${it.title ?? it.name ?? 'Article'}`)
    .join(', ')
    .slice(0, 400) || `Commande Shopify ${order.name ?? order.id}`;

  const weightGrams = lineItems.reduce((sum, it) => sum + Number(it.grams ?? 0), 0);
  const weight = weightGrams > 0 ? weightGrams / 1000 : defaultWeightKg;

  const receiverName =
    [shippingAddress.first_name, shippingAddress.last_name].filter(Boolean).join(' ').trim() ||
    customer.first_name ||
    'Client Shopify';
  const receiverPhone = shippingAddress.phone || customer.phone || '';
  const receiverEmail = customer.email || order.email || null;
  const receiverAddress = [
    shippingAddress.address1,
    shippingAddress.city,
    shippingAddress.country_code
  ].filter(Boolean).join(', ');

  return {
    senderId: senderId ?? null,
    senderName: order.shop_name ?? 'Shopify',
    senderPhone: order.shop_phone ?? '0',
    description,
    weight: Number.isFinite(weight) ? Number(weight.toFixed(2)) : defaultWeightKg,
    receiverName,
    receiverPhone,
    receiverEmail,
    receiverAddress: receiverAddress || 'Adresse Shopify',
    status: 'pending'
  };
}

/**
 * Résout le partenaire Shopify à partir du header `X-Shopify-Shop-Domain`.
 * Les partenaires sont configurés dans `system_configs` sous `apiKeys.business.<slug>`
 * avec une valeur `{ shopifyShopDomain, shopifyWebhookSecret, shopifySenderId }`.
 * Retourne `null` si aucun partenaire ne matche.
 */
export async function resolveShopifyPartner({ prisma, shopDomain }) {
  if (!shopDomain) return null;
  try {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { startsWith: CONFIG_PREFIX } }
    });
    for (const row of rows) {
      const v = row.value && typeof row.value === 'object' ? row.value : null;
      if (!v) continue;
      if (v.shopifyShopDomain === shopDomain && typeof v.shopifyWebhookSecret === 'string') {
        return {
          keyId: row.key.slice(CONFIG_PREFIX.length),
          partnerName: v.partnerName ?? row.key,
          shopDomain,
          webhookSecret: v.shopifyWebhookSecret,
          senderId: typeof v.shopifySenderId === 'string' ? v.shopifySenderId : null
        };
      }
    }
    return null;
  } catch (err) {
    logger.warn({ component: 'shopify', err: err.message }, 'resolveShopifyPartner failed');
    return null;
  }
}

export const SHOPIFY_SUPPORTED_TOPICS = Object.freeze([
  'orders/create',
  'fulfillments/create'
]);
