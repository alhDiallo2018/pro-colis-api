/**
 * Connecteur Magento 2 — webhook entrant signé HMAC-SHA256 (hex).
 *
 * Magento n'a pas de signature native sur les webhooks, mais la plupart des
 * modules officiels (Adobe Commerce, Mageplaza Webhook) exposent une
 * signature HMAC-SHA256 hex dans `X-Magento-Hmac-Sha256`. L'identifier du
 * partenaire est le header `X-Magento-Store-Domain`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../../config/logger.js';

const CONFIG_PREFIX = 'apiKeys.business.';

export function verifyMagentoHmac({ rawBody, headerHmac, secret }) {
  if (!rawBody || !headerHmac || !secret) return false;
  const expected = createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
    .digest('hex');
  if (expected.length !== headerHmac.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(headerHmac));
  } catch {
    return false;
  }
}

export function orderToParcelData(order, { senderId, defaultWeightKg = 1 } = {}) {
  if (!order || typeof order !== 'object') return null;
  const addresses = Array.isArray(order.addresses) ? order.addresses : [];
  const shipping = addresses.find((a) => a.address_type === 'shipping') || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const description = items
    .map((it) => `${it.qty_ordered ?? 1}× ${it.name ?? 'Article'}`)
    .join(', ')
    .slice(0, 400) || `Commande M2 ${order.increment_id ?? order.entity_id}`;

  const receiverName =
    [shipping.firstname, shipping.lastname].filter(Boolean).join(' ').trim() ||
    order.customer_firstname || 'Client Magento';
  const receiverPhone = shipping.telephone || '';
  const receiverEmail = order.customer_email || null;
  const streetLines = Array.isArray(shipping.street) ? shipping.street.join(', ') : (shipping.street || '');
  const receiverAddress = [streetLines, shipping.city, shipping.country_id].filter(Boolean).join(', ');

  const weight = Number(order.weight ?? 0);

  return {
    senderId: senderId ?? null,
    senderName: 'Magento',
    senderPhone: '0',
    description,
    weight: Number.isFinite(weight) && weight > 0 ? weight : defaultWeightKg,
    receiverName,
    receiverPhone,
    receiverEmail,
    receiverAddress: receiverAddress || 'Adresse Magento',
    status: 'pending'
  };
}

export async function resolveMagentoPartner({ prisma, storeDomain }) {
  if (!storeDomain) return null;
  const normalized = String(storeDomain).toLowerCase();
  try {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { startsWith: CONFIG_PREFIX } }
    });
    for (const row of rows) {
      const v = row.value && typeof row.value === 'object' ? row.value : null;
      if (!v) continue;
      if (
        typeof v.magentoStoreDomain === 'string' &&
        v.magentoStoreDomain.toLowerCase() === normalized &&
        typeof v.magentoWebhookSecret === 'string'
      ) {
        return {
          keyId: row.key.slice(CONFIG_PREFIX.length),
          partnerName: v.partnerName ?? row.key,
          storeDomain: normalized,
          webhookSecret: v.magentoWebhookSecret,
          senderId: typeof v.magentoSenderId === 'string' ? v.magentoSenderId : null
        };
      }
    }
    return null;
  } catch (err) {
    logger.warn({ component: 'magento', err: err.message }, 'resolveMagentoPartner failed');
    return null;
  }
}

export const MAGENTO_SUPPORTED_TOPICS = Object.freeze(['order.placed', 'order.updated']);
