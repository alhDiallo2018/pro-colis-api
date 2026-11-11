/**
 * Agrégateur de statistiques pour le dashboard B2B shipper — service pur.
 *
 * Prend une liste de colis d'un expéditeur sur une période et calcule :
 *  - volume total, livrés, en cours, annulés
 *  - coût moyen par colis
 *  - SLA respecté (pourcentage livrés à temps vs estimatedDeliveryDate)
 *  - top 3 destinations (par zoneId)
 *  - total facturé sur la période
 *
 * Aucune DB : prend des objets « simples » déjà sérialisés. Facile à tester.
 */

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {Array<object>} parcels
 * @returns {{
 *   volumeTotal: number,
 *   volumeDelivered: number,
 *   volumeInProgress: number,
 *   volumeCancelled: number,
 *   averageCost: number | null,
 *   totalBilled: number,
 *   slaOnTimePercent: number | null,
 *   topDestinations: Array<{ zoneId: string, name: string, count: number }>,
 *   byDay: Array<{ date: string, count: number }>
 * }}
 */
export function aggregateShipperStats(parcels) {
  if (!Array.isArray(parcels)) parcels = [];

  const inProgressStatuses = new Set([
    'pending',
    'free',
    'confirmed',
    'proposal_sent',
    'negotiating',
    'picked_up',
    'in_transit',
    'arrived',
    'out_for_delivery'
  ]);

  let volumeTotal = 0;
  let volumeDelivered = 0;
  let volumeInProgress = 0;
  let volumeCancelled = 0;
  let totalBilled = 0;
  let costSamples = 0;
  let costSum = 0;
  let slaSamples = 0;
  let slaOnTime = 0;

  const destCounts = new Map();
  const dayCounts = new Map();

  for (const p of parcels) {
    if (!p) continue;
    volumeTotal += 1;

    // Statuts
    if (p.status === 'delivered') volumeDelivered += 1;
    else if (p.status === 'cancelled') volumeCancelled += 1;
    else if (inProgressStatuses.has(p.status)) volumeInProgress += 1;

    // Facturation : on n'ajoute au total que les colis livrés (facturables).
    const amount = isFiniteNumber(p.totalAmount)
      ? p.totalAmount
      : isFiniteNumber(p.price)
        ? p.price
        : null;
    if (amount != null) {
      costSum += amount;
      costSamples += 1;
      if (p.status === 'delivered') totalBilled += amount;
    }

    // SLA : livrés dans les temps par rapport à estimatedDeliveryDate.
    if (p.status === 'delivered' && p.deliveryDate instanceof Date && p.estimatedDeliveryDate instanceof Date) {
      slaSamples += 1;
      if (p.deliveryDate.getTime() <= p.estimatedDeliveryDate.getTime()) {
        slaOnTime += 1;
      }
    }

    // Destinations
    if (typeof p.arrivalZoneId === 'string' && p.arrivalZoneId) {
      const prev = destCounts.get(p.arrivalZoneId);
      if (prev) prev.count += 1;
      else destCounts.set(p.arrivalZoneId, { zoneId: p.arrivalZoneId, name: p.arrivalZoneName ?? p.arrivalZoneId, count: 1 });
    }

    // Timeline par jour (créations).
    if (p.createdAt instanceof Date) {
      const key = p.createdAt.toISOString().slice(0, 10);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }
  }

  const topDestinations = [...destCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const byDay = [...dayCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  return {
    volumeTotal,
    volumeDelivered,
    volumeInProgress,
    volumeCancelled,
    averageCost: costSamples > 0 ? Math.round((costSum / costSamples) * 100) / 100 : null,
    totalBilled: Math.round(totalBilled * 100) / 100,
    slaOnTimePercent: slaSamples > 0 ? Math.round((slaOnTime / slaSamples) * 100) : null,
    topDestinations,
    byDay
  };
}
