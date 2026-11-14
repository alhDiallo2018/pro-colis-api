import { createHmac, randomBytes } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { verifyWooCommerceHmac, orderToParcelData as wooToParcel } from '../src/modules/integrations/woocommerce.js';
import { verifyMagentoHmac, orderToParcelData as m2ToParcel } from '../src/modules/integrations/magento.js';
import { invalidatePartnersCache } from '../src/utils/shipment-webhook-service.js';

const SUFFIX = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
const WC_SITE = `https://wc-${SUFFIX}.example.com`;
const M2_DOMAIN = `m2-${SUFFIX}.example.com`;
const WC_SECRET = 'wc-secret';
const M2_SECRET = 'm2-secret';

describe('INT-2 / INT-3 — WooCommerce + Magento webhooks', () => {
  const createdParcelIds = [];
  let wcKey;
  let m2Key;

  beforeAll(async () => {
    wcKey = `apiKeys.business.wc-${SUFFIX}`;
    m2Key = `apiKeys.business.m2-${SUFFIX}`;
    await prisma.systemConfig.createMany({
      data: [
        {
          key: wcKey,
          value: {
            partnerName: 'WC Test',
            woocommerceSiteUrl: WC_SITE,
            woocommerceWebhookSecret: WC_SECRET
          }
        },
        {
          key: m2Key,
          value: {
            partnerName: 'M2 Test',
            magentoStoreDomain: M2_DOMAIN,
            magentoWebhookSecret: M2_SECRET
          }
        }
      ]
    });
    invalidatePartnersCache();
  });

  afterAll(async () => {
    if (createdParcelIds.length) {
      await prisma.parcel.deleteMany({ where: { id: { in: createdParcelIds } } });
    }
    await prisma.systemConfig.deleteMany({ where: { key: { in: [wcKey, m2Key] } } });
    invalidatePartnersCache();
    await prisma.$disconnect();
  });

  // ─── WooCommerce ───
  test('verifyWooCommerceHmac : succès + échec', () => {
    const body = Buffer.from('{"id":1}');
    const good = createHmac('sha256', WC_SECRET).update(body).digest('base64');
    expect(verifyWooCommerceHmac({ rawBody: body, headerHmac: good, secret: WC_SECRET })).toBe(true);
    expect(verifyWooCommerceHmac({ rawBody: body, headerHmac: 'bad', secret: WC_SECRET })).toBe(false);
  });

  test('wooToParcel : conversion minimale', () => {
    const data = wooToParcel({
      id: 42,
      number: '42',
      shipping: { first_name: 'Awa', last_name: 'Fall', phone: '77111', address_1: 'Rue A', city: 'Dakar', country: 'SN' },
      billing: { email: 'awa@example.com' },
      line_items: [{ quantity: 2, name: 'Pagne' }]
    });
    expect(data.receiverName).toBe('Awa Fall');
    expect(data.receiverPhone).toBe('77111');
    expect(data.description).toContain('Pagne');
  });

  test('POST /integrations/woocommerce/webhooks : HMAC valide → parcel créé', async () => {
    const order = {
      id: 101,
      number: `WC-${SUFFIX}`,
      shipping: { first_name: 'Awa', last_name: 'Fall', phone: '77000000', address_1: 'X', city: 'Dakar', country: 'SN' },
      billing: { email: 'awa@example.com' },
      line_items: [{ quantity: 1, name: 'Pagne' }]
    };
    const body = JSON.stringify(order);
    const hmac = createHmac('sha256', WC_SECRET).update(body).digest('base64');
    const res = await request(app)
      .post('/api/v1/integrations/woocommerce/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-wc-webhook-topic', 'order.created')
      .set('x-wc-webhook-source', WC_SITE)
      .set('x-wc-webhook-signature', hmac)
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.parcel?.trackingNumber).toBeTruthy();
    createdParcelIds.push(res.body.parcel.id);
  });

  test('POST /woocommerce : site inconnu → 404', async () => {
    const body = JSON.stringify({});
    const res = await request(app)
      .post('/api/v1/integrations/woocommerce/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-wc-webhook-topic', 'order.created')
      .set('x-wc-webhook-source', 'https://unknown.example.com')
      .set('x-wc-webhook-signature', 'x')
      .send(body);
    expect(res.status).toBe(404);
  });

  // ─── Magento ───
  test('verifyMagentoHmac : succès + échec (hex)', () => {
    const body = Buffer.from('{"entity_id":1}');
    const good = createHmac('sha256', M2_SECRET).update(body).digest('hex');
    expect(verifyMagentoHmac({ rawBody: body, headerHmac: good, secret: M2_SECRET })).toBe(true);
    expect(verifyMagentoHmac({ rawBody: body, headerHmac: 'bad', secret: M2_SECRET })).toBe(false);
  });

  test('m2ToParcel : conversion minimale', () => {
    const data = m2ToParcel({
      entity_id: 123,
      increment_id: '000001',
      customer_firstname: 'Khadija',
      customer_email: 'k@example.com',
      weight: 1.5,
      addresses: [{
        address_type: 'shipping',
        firstname: 'Khadija',
        lastname: 'Ba',
        telephone: '77222',
        street: ['12 avenue X'],
        city: 'Mbour',
        country_id: 'SN'
      }],
      items: [{ qty_ordered: 1, name: 'Boubou' }]
    });
    expect(data.receiverName).toBe('Khadija Ba');
    expect(data.receiverPhone).toBe('77222');
    expect(data.weight).toBe(1.5);
  });

  test('POST /integrations/magento/webhooks : HMAC valide → parcel créé', async () => {
    const order = {
      entity_id: 777,
      increment_id: `M2-${SUFFIX}`,
      customer_email: 'k@example.com',
      weight: 2,
      addresses: [{
        address_type: 'shipping',
        firstname: 'Khadija',
        lastname: 'Ba',
        telephone: '77222',
        street: ['12 X'],
        city: 'Mbour',
        country_id: 'SN'
      }],
      items: [{ qty_ordered: 1, name: 'Boubou' }]
    };
    const body = JSON.stringify(order);
    const hmac = createHmac('sha256', M2_SECRET).update(body).digest('hex');
    const res = await request(app)
      .post('/api/v1/integrations/magento/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-magento-topic', 'order.placed')
      .set('x-magento-store-domain', M2_DOMAIN)
      .set('x-magento-hmac-sha256', hmac)
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.parcel?.trackingNumber).toBeTruthy();
    createdParcelIds.push(res.body.parcel.id);
  });

  test('POST /magento : HMAC invalide → 401', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/magento/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-magento-topic', 'order.placed')
      .set('x-magento-store-domain', M2_DOMAIN)
      .set('x-magento-hmac-sha256', 'wrong')
      .send(JSON.stringify({ entity_id: 2 }));
    expect(res.status).toBe(401);
  });
});
