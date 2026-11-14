// src/modules/integrations/integrations.routes.js
//
// Webhooks entrants partenaires. Pas d'authentification utilisateur :
// chaque partenaire signe ses requêtes avec un secret partagé, vérifié
// côté serveur (HMAC-SHA256).
//
// INT-1 — Shopify : POST /integrations/shopify/webhooks

import express from 'express';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import {
  verifyShopifyHmac,
  orderToParcelData as shopifyOrderToParcelData,
  resolveShopifyPartner,
  SHOPIFY_SUPPORTED_TOPICS
} from './shopify.js';
import {
  verifyWooCommerceHmac,
  orderToParcelData as wooOrderToParcelData,
  resolveWooCommercePartner,
  WOOCOMMERCE_SUPPORTED_TOPICS
} from './woocommerce.js';
import {
  verifyMagentoHmac,
  orderToParcelData as magentoOrderToParcelData,
  resolveMagentoPartner,
  MAGENTO_SUPPORTED_TOPICS
} from './magento.js';
import { generateTrackingNumber } from '../../utils/tracking-number.js';

export const integrationsRouter = express.Router();

integrationsRouter.post('/shopify/webhooks', async (req, res) => {
  const topic = String(req.header('x-shopify-topic') ?? '').trim();
  const shopDomain = String(req.header('x-shopify-shop-domain') ?? '').trim();
  const hmac = String(req.header('x-shopify-hmac-sha256') ?? '').trim();
  const rawBody = req.rawBody;

  if (!topic || !shopDomain || !hmac || !rawBody) {
    return res.status(400).json({ success: false, error: { code: 'BAD_WEBHOOK', message: 'Headers Shopify manquants' } });
  }

  if (!SHOPIFY_SUPPORTED_TOPICS.includes(topic)) {
    // On acquitte pour éviter que Shopify retente indéfiniment, mais on ne
    // fait rien côté métier.
    logger.info({ component: 'shopify', topic, shopDomain }, 'Shopify topic ignoré');
    return res.status(200).json({ success: true, ignored: true });
  }

  const partner = await resolveShopifyPartner({ prisma, shopDomain });
  if (!partner) {
    logger.warn({ component: 'shopify', shopDomain }, 'Shop domain inconnu');
    return res.status(404).json({ success: false, error: { code: 'UNKNOWN_SHOP', message: 'Boutique non enregistrée' } });
  }

  if (!verifyShopifyHmac({ rawBody, headerHmac: hmac, secret: partner.webhookSecret })) {
    logger.warn({ component: 'shopify', shopDomain, topic }, 'HMAC invalide');
    return res.status(401).json({ success: false, error: { code: 'INVALID_HMAC', message: 'Signature invalide' } });
  }

  try {
    if (topic === 'orders/create') {
      const data = shopifyOrderToParcelData(req.body, { senderId: partner.senderId });
      if (!data) {
        return res.status(422).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Commande illisible' } });
      }
      const parcel = await prisma.parcel.create({
        data: {
          ...data,
          trackingNumber: generateTrackingNumber()
        }
      });
      logger.info({ component: 'shopify', parcelId: parcel.id, partner: partner.partnerName }, 'Parcel créé depuis Shopify');
      return res.status(201).json({ success: true, parcel: { id: parcel.id, trackingNumber: parcel.trackingNumber } });
    }

    if (topic === 'fulfillments/create') {
      // L'orderId référencé est présent dans `req.body.order_id`. Retrouver
      // un parcel créé depuis cette commande demanderait un index dédié —
      // V1 : on journalise et acquitte.
      logger.info({ component: 'shopify', orderId: req.body?.order_id }, 'Fulfillment reçu (no-op V1)');
      return res.status(200).json({ success: true });
    }
  } catch (err) {
    logger.error({ component: 'shopify', err: err.message, topic }, 'Shopify webhook failed');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: err.message } });
  }

  return res.status(200).json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────
// WooCommerce
// ─────────────────────────────────────────────────────────────────────
integrationsRouter.post('/woocommerce/webhooks', async (req, res) => {
  const topic = String(req.header('x-wc-webhook-topic') ?? '').trim();
  const siteUrl = String(req.header('x-wc-webhook-source') ?? '').trim();
  const hmac = String(req.header('x-wc-webhook-signature') ?? '').trim();
  const rawBody = req.rawBody;

  if (!topic || !siteUrl || !hmac || !rawBody) {
    return res.status(400).json({ success: false, error: { code: 'BAD_WEBHOOK', message: 'Headers WooCommerce manquants' } });
  }
  if (!WOOCOMMERCE_SUPPORTED_TOPICS.includes(topic)) {
    logger.info({ component: 'woocommerce', topic, siteUrl }, 'WC topic ignoré');
    return res.status(200).json({ success: true, ignored: true });
  }
  const partner = await resolveWooCommercePartner({ prisma, siteUrl });
  if (!partner) return res.status(404).json({ success: false, error: { code: 'UNKNOWN_SHOP', message: 'Boutique WC non enregistrée' } });
  if (!verifyWooCommerceHmac({ rawBody, headerHmac: hmac, secret: partner.webhookSecret })) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_HMAC', message: 'Signature WC invalide' } });
  }

  try {
    if (topic === 'order.created') {
      const data = wooOrderToParcelData(req.body, { senderId: partner.senderId });
      if (!data) return res.status(422).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Commande illisible' } });
      const parcel = await prisma.parcel.create({
        data: { ...data, trackingNumber: generateTrackingNumber() }
      });
      logger.info({ component: 'woocommerce', parcelId: parcel.id }, 'Parcel créé depuis WC');
      return res.status(201).json({ success: true, parcel: { id: parcel.id, trackingNumber: parcel.trackingNumber } });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ component: 'woocommerce', err: err.message }, 'WC webhook failed');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Magento 2
// ─────────────────────────────────────────────────────────────────────
integrationsRouter.post('/magento/webhooks', async (req, res) => {
  const topic = String(req.header('x-magento-topic') ?? '').trim();
  const storeDomain = String(req.header('x-magento-store-domain') ?? '').trim();
  const hmac = String(req.header('x-magento-hmac-sha256') ?? '').trim();
  const rawBody = req.rawBody;

  if (!topic || !storeDomain || !hmac || !rawBody) {
    return res.status(400).json({ success: false, error: { code: 'BAD_WEBHOOK', message: 'Headers Magento manquants' } });
  }
  if (!MAGENTO_SUPPORTED_TOPICS.includes(topic)) {
    logger.info({ component: 'magento', topic, storeDomain }, 'M2 topic ignoré');
    return res.status(200).json({ success: true, ignored: true });
  }
  const partner = await resolveMagentoPartner({ prisma, storeDomain });
  if (!partner) return res.status(404).json({ success: false, error: { code: 'UNKNOWN_SHOP', message: 'Boutique M2 non enregistrée' } });
  if (!verifyMagentoHmac({ rawBody, headerHmac: hmac, secret: partner.webhookSecret })) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_HMAC', message: 'Signature M2 invalide' } });
  }

  try {
    if (topic === 'order.placed') {
      const data = magentoOrderToParcelData(req.body, { senderId: partner.senderId });
      if (!data) return res.status(422).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Commande illisible' } });
      const parcel = await prisma.parcel.create({
        data: { ...data, trackingNumber: generateTrackingNumber() }
      });
      logger.info({ component: 'magento', parcelId: parcel.id }, 'Parcel créé depuis M2');
      return res.status(201).json({ success: true, parcel: { id: parcel.id, trackingNumber: parcel.trackingNumber } });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ component: 'magento', err: err.message }, 'M2 webhook failed');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: err.message } });
  }
});
