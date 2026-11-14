import { createHmac, randomBytes } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { verifyShopifyHmac, orderToParcelData } from '../src/modules/integrations/shopify.js';
import { invalidatePartnersCache } from '../src/utils/shipment-webhook-service.js';

const SHOP_DOMAIN = `test-shop-${Date.now()}.myshopify.com`;
const SECRET = 'shopify-test-secret';

function hmacBase64(body) {
  return createHmac('sha256', SECRET).update(body).digest('base64');
}

describe('INT-1 — Shopify webhook-in', () => {
  const suffix = `${Date.now().toString().slice(-7)}${randomBytes(2).toString('hex')}`;
  const createdParcelIds = [];
  let partnerKey;

  beforeAll(async () => {
    partnerKey = `apiKeys.business.shopify-${suffix}`;
    await prisma.systemConfig.create({
      data: {
        key: partnerKey,
        value: {
          partnerName: 'Shopify Test',
          shopifyShopDomain: SHOP_DOMAIN,
          shopifyWebhookSecret: SECRET,
          scopes: ['shipments.read']
        }
      }
    });
    invalidatePartnersCache();
  });

  afterAll(async () => {
    if (createdParcelIds.length) {
      await prisma.parcel.deleteMany({ where: { id: { in: createdParcelIds } } });
    }
    await prisma.systemConfig.deleteMany({ where: { key: partnerKey } });
    invalidatePartnersCache();
    await prisma.$disconnect();
  });

  test('verifyShopifyHmac : succès + échec', () => {
    const body = Buffer.from('{"a":1}');
    const good = hmacBase64(body);
    expect(verifyShopifyHmac({ rawBody: body, headerHmac: good, secret: SECRET })).toBe(true);
    expect(verifyShopifyHmac({ rawBody: body, headerHmac: 'bad', secret: SECRET })).toBe(false);
    expect(verifyShopifyHmac({ rawBody: body, headerHmac: good, secret: 'other' })).toBe(false);
  });

  test('orderToParcelData : conversion minimale', () => {
    const data = orderToParcelData({
      id: 123,
      name: '#1001',
      shipping_address: { first_name: 'Fatou', last_name: 'Diop', phone: '771234567', address1: '42 rue X', city: 'Dakar', country_code: 'SN' },
      line_items: [
        { quantity: 2, title: 'Bogolan', grams: 500 },
        { quantity: 1, title: 'Boubou', grams: 800 }
      ],
      customer: { email: 'fatou@example.com' }
    });
    expect(data.receiverName).toBe('Fatou Diop');
    expect(data.receiverPhone).toBe('771234567');
    expect(data.weight).toBeCloseTo(1.3);
    expect(data.description).toContain('Bogolan');
    expect(data.description).toContain('Boubou');
    expect(data.status).toBe('pending');
  });

  test('POST /integrations/shopify/webhooks : topic non supporté → 200 ignoré', async () => {
    const body = JSON.stringify({ id: 1 });
    const res = await request(app)
      .post('/api/v1/integrations/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-shopify-topic', 'customers/create')
      .set('x-shopify-shop-domain', SHOP_DOMAIN)
      .set('x-shopify-hmac-sha256', hmacBase64(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });

  test('POST webhooks : shop inconnu → 404', async () => {
    const body = JSON.stringify({ id: 2 });
    const res = await request(app)
      .post('/api/v1/integrations/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-shopify-topic', 'orders/create')
      .set('x-shopify-shop-domain', 'unknown.myshopify.com')
      .set('x-shopify-hmac-sha256', 'anything')
      .send(body);
    expect(res.status).toBe(404);
  });

  test('POST webhooks : HMAC invalide → 401', async () => {
    const body = JSON.stringify({ id: 3 });
    const res = await request(app)
      .post('/api/v1/integrations/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-shopify-topic', 'orders/create')
      .set('x-shopify-shop-domain', SHOP_DOMAIN)
      .set('x-shopify-hmac-sha256', 'invalid')
      .send(body);
    expect(res.status).toBe(401);
  });

  test('POST webhooks orders/create : HMAC valide → parcel créé', async () => {
    const order = {
      id: 4001,
      name: `#TEST-${suffix}`,
      shipping_address: {
        first_name: 'Aminata',
        last_name: 'Kane',
        phone: '770000000',
        address1: 'Plateau',
        city: 'Dakar',
        country_code: 'SN'
      },
      line_items: [{ quantity: 1, title: 'Sac', grams: 300 }],
      customer: { email: 'aminata@example.com' }
    };
    const body = JSON.stringify(order);
    const res = await request(app)
      .post('/api/v1/integrations/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-shopify-topic', 'orders/create')
      .set('x-shopify-shop-domain', SHOP_DOMAIN)
      .set('x-shopify-hmac-sha256', hmacBase64(body))
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.parcel.id).toBeTruthy();
    expect(res.body.parcel.trackingNumber).toBeTruthy();
    createdParcelIds.push(res.body.parcel.id);

    const stored = await prisma.parcel.findUnique({ where: { id: res.body.parcel.id } });
    expect(stored.receiverName).toBe('Aminata Kane');
    expect(stored.status).toBe('pending');
  });

  test('POST fulfillments/create : HMAC valide → 200 (no-op V1)', async () => {
    const body = JSON.stringify({ order_id: 4001, tracking_number: 'ABC' });
    const res = await request(app)
      .post('/api/v1/integrations/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-shopify-topic', 'fulfillments/create')
      .set('x-shopify-shop-domain', SHOP_DOMAIN)
      .set('x-shopify-hmac-sha256', hmacBase64(body))
      .send(body);
    expect(res.status).toBe(200);
  });
});
