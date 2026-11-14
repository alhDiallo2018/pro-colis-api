/**
 * Connecteur WooCommerce — webhook entrant signé HMAC-SHA256.
 *
 * WC envoie dans `X-WC-Webhook-Signature` l'HMAC-SHA256 base64 du body avec
 * le `secret` configuré au niveau du webhook côté WooCommerce admin.
 * `X-WC-Webhook-Source` porte l'URL du site (identifier le partenaire).
 *
 * Topics supportés V1 : `order.created` (crée un Parcel), `order.updated`
 * (no-op pour l'instant ; en V2 mettre à jour un champ metadata).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../../config/logger.js';

const CONFIG_PREFIX = 'apiKeys.business.';

export function verifyWooCommerceHmac({ rawBody, headerHmac, secret }) {
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
 * Convertit un order WC en données de Parcel.
 */
export function orderToParcelData(order, { senderId, defaultWeightKg = 1 } = {}) {
  if (!order || typeof order !== 'object') return null;
  const shipping = order.shipping || {};
  const billing = order.billing || {};
  const items = Array.isArray(order.line_items) ? order.line_items : [];

  const description = items
    .map((it) => `${it.quantity ?? 1}× ${it.name ?? 'Article'}`)
    .join(', ')
    .slice(0, 400) || `Commande WC ${order.number ?? order.id}`;

  // WC line_items n'a pas de poids standard dans le payload — on retombe sur un défaut.
  const receiverName =
    [shipping.first_name, shipping.last_name].filter(Boolean).join(' ').trim() ||
    [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() ||
    'Client WC';
  const receiverPhone = shipping.phone || billing.phone || '';
  const receiverEmail = billing.email || order.customer_email || null;
  const receiverAddress = [
    shipping.address_1 || billing.address_1,
    shipping.city || billing.city,
    shipping.country || billing.country
  ].filter(Boolean).join(', ');

  return {
    senderId: senderId ?? null,
    senderName: order.store?.name ?? 'WooCommerce',
    senderPhone: order.store?.phone ?? '0',
    description,
    weight: defaultWeightKg,
    receiverName,
    receiverPhone,
    receiverEmail,
    receiverAddress: receiverAddress || 'Adresse WooCommerce',
    status: 'pending'
  };
}

export async function resolveWooCommercePartner({ prisma, siteUrl }) {
  if (!siteUrl) return null;
  const normalized = String(siteUrl).replace(/\/+$/, '').toLowerCase();
  try {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { startsWith: CONFIG_PREFIX } }
    });
    for (const row of rows) {
      const v = row.value && typeof row.value === 'object' ? row.value : null;
      if (!v) continue;
      const configured = typeof v.woocommerceSiteUrl === 'string'
        ? v.woocommerceSiteUrl.replace(/\/+$/, '').toLowerCase()
        : null;
      if (configured && configured === normalized && typeof v.woocommerceWebhookSecret === 'string') {
        return {
          keyId: row.key.slice(CONFIG_PREFIX.length),
          partnerName: v.partnerName ?? row.key,
          siteUrl: normalized,
          webhookSecret: v.woocommerceWebhookSecret,
          senderId: typeof v.woocommerceSenderId === 'string' ? v.woocommerceSenderId : null
        };
      }
    }
    return null;
  } catch (err) {
    logger.warn({ component: 'woocommerce', err: err.message }, 'resolveWooCommercePartner failed');
    return null;
  }
}

export const WOOCOMMERCE_SUPPORTED_TOPICS = Object.freeze(['order.created', 'order.updated']);
