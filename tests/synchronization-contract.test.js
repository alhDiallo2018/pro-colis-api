import { app } from '../src/app.js';
import {
  serializeBid,
  serializeDriverWalletTransaction
} from '../src/utils/mobile-serializers.js';

/**
 * Parcourt les routers Express imbriques. Ces tests ne contactent pas la base :
 * ils verrouillent le contrat HTTP commun utilise par les builds web et mobile.
 */
function collectRoutes(stack, routes = []) {
  for (const layer of stack || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
      continue;
    }

    if (layer.name === 'router') {
      collectRoutes(layer.handle.stack, routes);
    }
  }
  return routes;
}

describe('web/mobile synchronization contract', () => {
  it('keeps canonical and legacy negotiation routes available', () => {
    const routes = collectRoutes(app._router?.stack);

    expect(routes).toEqual(
      expect.arrayContaining([
        'POST /client/bids/:bidId/negotiate',
        'POST /client/bids/:bidId/counter',
        'POST /driver/bids/:bidId/respond',
        'POST /driver/bids/:bidId/respond-counter',
        'GET /bids/:bidId/negotiation'
      ])
    );
  });

  it('serializes negotiation history identically for both clients', () => {
    const bid = serializeBid({
      id: 'bid-1',
      parcelId: 'parcel-1',
      driverId: 'driver-1',
      price: 12_000,
      status: 'countered',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      updatedAt: new Date('2026-07-28T12:05:00.000Z'),
      negotiationMessages: [
        {
          id: 'negotiation-1',
          fromUserId: 'client-1',
          fromUserRole: 'client',
          price: 10_000,
          message: 'Ma contre-offre',
          createdAt: new Date('2026-07-28T12:03:00.000Z')
        }
      ]
    });

    expect(bid.negotiationHistory).toEqual([
      {
        id: 'negotiation-1',
        fromUserId: 'client-1',
        fromUserRole: 'client',
        price: 10_000,
        message: 'Ma contre-offre',
        createdAt: '2026-07-28T12:03:00.000Z'
      }
    ]);
  });

  it('serializes wallet debits with the sign expected by Flutter', () => {
    const transaction = serializeDriverWalletTransaction({
      id: 'transaction-1',
      walletUserId: 'driver-1',
      type: 'commission',
      amount: 500,
      balanceBefore: 4_000,
      balanceAfter: 3_500,
      parcelId: 'parcel-1',
      parcel: { trackingNumber: 'PC-2026-001' },
      description: 'Commission livraison',
      origin: 'cash_delivery',
      status: 'completed',
      performedBy: null,
      createdAt: new Date('2026-07-28T13:00:00.000Z')
    });

    expect(transaction).toMatchObject({
      userId: 'driver-1',
      amount: -500,
      rawAmount: 500,
      trackingNumber: 'PC-2026-001',
      balanceBefore: 4_000,
      balanceAfter: 3_500,
      createdAt: '2026-07-28T13:00:00.000Z'
    });
  });
});
