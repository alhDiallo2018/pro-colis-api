// Appelée dans la transaction qui publie/modifie le départ. L'alerte concerne
// le sens exact des arrêts, jamais le trajet inverse ni une position GPS.
export async function notifyRouteAlerts(tx, ad) {
  if (ad.status !== 'open' || !ad.departureAt || new Date(ad.departureAt) <= new Date()) return;
  const stops = ad.metadata?.itinerary?.stops?.map(s => s.zoneId) ?? [ad.departureZoneId, ad.arrivalZoneId];
  const alerts = await tx.routeAlert.findMany({ where: { expiresAt: { gt: new Date() },
    departureZoneId: { in: stops.filter(Boolean) }, arrivalZoneId: { in: stops.filter(Boolean) }, userId: { not: ad.driverId } } });
  for (const alert of alerts) {
    if (stops.indexOf(alert.arrivalZoneId) <= stops.indexOf(alert.departureZoneId)) continue;
    // La contrainte composée protège aussi contre les publications concurrentes
    // et les reprises après perte de connexion ; tout est annulé si la notification échoue.
    const inserted = await tx.routeAlertDelivery.createMany({ data: [{ alertId: alert.id, advertisementId: ad.id }], skipDuplicates: true });
    if (!inserted.count) continue;
    await tx.notification.create({ data: { userId: alert.userId, type: 'route_alert', title: 'Un départ correspond à votre trajet',
      body: 'Un chauffeur a publié un départ. Consultez les horaires et négociez le prix avant de réserver.',
      data: { advertisementId: ad.id, alertId: alert.id }, senderId: ad.driverId, senderName: 'SendProColis' } });
  }
}
