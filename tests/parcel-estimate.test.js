import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

/**
 * `POST /parcels/estimate` codait son bareme en dur (1000 / 500 / 1000 / 1000)
 * alors que les quatre cles `pricing.*` sont editables par le super
 * administrateur, web et mobile. Un tarif change dans l'ecran de configuration
 * ne bougeait donc aucune estimation.
 */
describe('estimation de colis', () => {
  const KEYS = [
    'pricing.baseFee',
    'pricing.pricePerKg',
    'pricing.urgentFee',
    'pricing.insuranceFee'
  ];

  async function setPricing(values) {
    for (const [key, value] of Object.entries(values)) {
      await prisma.systemConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      });
    }
  }

  afterEach(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { in: KEYS } } });
  });

  it('applique le bareme par defaut quand aucune cle n est configuree', async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { in: KEYS } } });

    const res = await request(app)
      .post('/api/v1/parcels/estimate')
      .send({ weight: 2 });

    expect(res.status).toBe(200);
    // 1000 + 2 x 500
    expect(res.body.estimate.amount).toBe(2000);
    expect(res.body.estimate.baseFee).toBe(1000);
    expect(res.body.estimate.pricePerKg).toBe(500);
  });

  it('suit le bareme configure par le super administrateur', async () => {
    await setPricing({
      'pricing.baseFee': 2500,
      'pricing.pricePerKg': 750,
      'pricing.urgentFee': 3000,
      'pricing.insuranceFee': 1200
    });

    const res = await request(app)
      .post('/api/v1/parcels/estimate')
      .send({ weight: 4, isUrgent: true, isInsured: true });

    expect(res.status).toBe(200);
    // 2500 + 4 x 750 + 3000 + 1200
    expect(res.body.estimate.amount).toBe(9700);
    expect(res.body.estimate.baseFee).toBe(2500);
    expect(res.body.estimate.pricePerKg).toBe(750);
    expect(res.body.estimate.urgentFee).toBe(3000);
    expect(res.body.estimate.insuranceFee).toBe(1200);
  });

  it('ne facture urgence et assurance que si elles sont demandees', async () => {
    await setPricing({ 'pricing.urgentFee': 3000, 'pricing.insuranceFee': 1200 });

    const res = await request(app)
      .post('/api/v1/parcels/estimate')
      .send({ weight: 1 });

    expect(res.body.estimate.urgentFee).toBe(0);
    expect(res.body.estimate.insuranceFee).toBe(0);
    expect(res.body.estimate.amount).toBe(1500);
  });

  it('accepte un tarif stocke sous forme de chaine', async () => {
    // `SystemConfig.value` est un Json libre : l'ecran d'administration peut y
    // ecrire une chaine sans que l'estimation tombe a zero.
    await setPricing({ 'pricing.baseFee': '3000', 'pricing.pricePerKg': '250' });

    const res = await request(app)
      .post('/api/v1/parcels/estimate')
      .send({ weight: 2 });

    expect(res.body.estimate.amount).toBe(3500);
  });
});
