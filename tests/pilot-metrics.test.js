import { buildPilotMetrics } from '../src/utils/pilot-metrics.js';

describe('buildPilotMetrics', () => {
  test('tolère une entrée vide', () => {
    const m = buildPilotMetrics({});
    expect(m.referrals.total).toBe(0);
    expect(m.insurance.active).toBe(0);
    expect(m.apiKeys.active).toBe(0);
    expect(m.whatsapp).toBeNull();
    expect(m.aiAssistant).toBeNull();
    expect(m.anomalies).toBeNull();
    expect(m.sla).toBeNull();
    expect(m.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('calcule le taux de conversion parrainage', () => {
    const m = buildPilotMetrics({
      referrals: { total: 10, pending: 4, triggered: 6 }
    });
    expect(m.referrals.total).toBe(10);
    expect(m.referrals.triggered).toBe(6);
    expect(m.referrals.conversionPercent).toBe(60);
  });

  test('conversionPercent null si total = 0', () => {
    const m = buildPilotMetrics({ referrals: { total: 0 } });
    expect(m.referrals.conversionPercent).toBeNull();
  });

  test('calcule le taux de livraison WhatsApp', () => {
    const m = buildPilotMetrics({
      whatsapp: { sent: 100, delivered: 95, read: 60 }
    });
    expect(m.whatsapp.deliveryRatePercent).toBe(95);
    expect(m.whatsapp.readRatePercent).toBe(60);
  });

  test('aggrège le total anomalies', () => {
    const m = buildPilotMetrics({
      anomalies: { gpsSilence: 3, prolongedStop: 1, routeDeviation: 2 }
    });
    expect(m.anomalies.total).toBe(6);
  });

  test('calcule SLA on-time', () => {
    const m = buildPilotMetrics({
      sla: { delivered: 50, deliveredOnTime: 45 }
    });
    expect(m.sla.onTimePercent).toBe(90);
  });

  test('ignore les compteurs négatifs (sanitisation)', () => {
    const m = buildPilotMetrics({
      referrals: { total: -5, triggered: 3 }
    });
    expect(m.referrals.total).toBe(0);
    expect(m.referrals.triggered).toBe(3);
  });

  test("tolère un claimRate avec zéro souscription", () => {
    const m = buildPilotMetrics({ insurance: { active: 0, claimed: 0, cancelled: 0 } });
    expect(m.insurance.claimRatePercent).toBeNull();
  });

  test('taux IA assistant', () => {
    const m = buildPilotMetrics({
      aiAssistant: { requested: 20, completed: 17 }
    });
    expect(m.aiAssistant.successRatePercent).toBe(85);
  });
});
