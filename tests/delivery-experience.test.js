import { nextAction, repeatData, trackingHealth } from '../src/modules/experience/presentation.js';

test('la copie ne transporte aucun engagement ni secret de la livraison précédente', () => {
  const result = repeatData({ receiverName: 'Awa', weight: '2.5', price: 1000, assignedDriverId: 'driver', paymentStatus: 'completed', signatureUrl: 'secret' });
  expect(result).toMatchObject({ receiverName: 'Awa', weight: 2.5 });
  for (const field of ['price','assignedDriverId','paymentStatus','signatureUrl']) expect(result).not.toHaveProperty(field);
});
test('une position ancienne ou future ne doit pas être annoncée en direct', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const parcel = { status: 'in_transit', estimatedDeliveryDate: '2026-10-28T11:00:00Z' };
  expect(trackingHealth(parcel, { createdAt: '2026-10-28T11:50:00Z' }, now)).toMatchObject({ positionFresh: false, overdue: true });
  expect(trackingHealth(parcel, { createdAt: '2026-10-28T12:00:10Z' }, now).positionFresh).toBe(false);
  expect(trackingHealth({ ...parcel, status: 'delivered' }, null, now).overdue).toBe(false);
});
test('les consignes de remise distinguent expéditeur et chauffeur', () => {
  expect(nextAction({status:'out_for_delivery'},'client').description).toContain('uniquement');
  expect(nextAction({status:'out_for_delivery'},'driver').title).toBe('Confirmer la remise');
});
