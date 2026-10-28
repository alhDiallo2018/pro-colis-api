// Ces indications décrivent l'état existant : elles n'autorisent aucune
// transition et ne remplacent jamais les contrôles des routes métier.
export function nextAction(parcel, role) {
  const driver = role === 'driver';
  if (!driver && parcel.status === 'free' && parcel._count?.bids === 0) return { title: 'Attendre une offre', description: 'Votre annonce est publiée. Vous serez averti lorsqu’un chauffeur vous proposera un prix.' };
  if (parcel.status === 'negotiating' && parcel.lastOfferBy === role) return { title: 'Attendre la réponse', description: 'Votre dernier prix a été envoyé. Retrouvez la proposition dans les échanges du colis.' };
  const labels = {
    free: ['Choisir une offre', 'Consulter les offres reçues et discuter du prix avant de choisir.', 'Proposer un prix', 'Attendre l’accord du client avant la prise en charge.'],
    pending: ['Attendre la réponse du chauffeur', 'Vous pouvez consulter les échanges du colis.', 'Répondre à la demande', 'Relire le trajet et le prix proposé.'],
    proposal_sent: ['Suivre la proposition', 'Le chauffeur doit répondre à votre demande.', 'Répondre à la proposition', 'Accepter ou discuter du prix dans la conversation.'],
    negotiating: ['Poursuivre la négociation', 'Vérifier le dernier prix et le prochain interlocuteur dans les échanges.', 'Poursuivre la négociation', 'Vérifier le dernier prix et le prochain interlocuteur dans les échanges.'],
    confirmed: ['Préparer la remise du colis', 'Convenir du lieu et de l’heure avec le chauffeur.', 'Prendre en charge le colis', 'Vérifier le colis avant de confirmer sa prise en charge.'],
    picked_up: ['Suivre le départ', 'Le chauffeur a pris votre colis en charge.', 'Confirmer le départ', 'Mettre à jour la mission lorsque le transport commence.'],
    in_transit: ['Suivre le trajet', 'Consulter la dernière mise à jour et rester joignable.', 'Signaler l’arrivée', 'Mettre à jour la mission à l’arrivée.'],
    arrived: ['Préparer la réception', 'Prévenir le destinataire que le colis est arrivé.', 'Préparer la remise', 'Contacter le destinataire avant la livraison finale.'],
    out_for_delivery: ['Recevoir le colis', 'Communiquer le code uniquement lors de la remise effective du colis.', 'Confirmer la remise', 'Demander le code au destinataire lors de la remise effective.'],
    delivered: ['Consulter le récapitulatif', 'La livraison est terminée. Le support reste accessible en cas de problème.', 'Consulter le récapitulatif', 'Vérifier les encaissements et la commission de la livraison.'],
    cancelled: ['Consulter l’annulation', 'Les éventuels remboursements et pénalités suivent les règles existantes.', 'Consulter l’annulation', 'Les éventuels ajustements suivent les règles existantes.'],
  };
  const row = labels[parcel.status] ?? ['Consulter le suivi', 'Ouvrir le détail du colis.', 'Consulter le suivi', 'Ouvrir le détail du colis.'];
  return { title: row[driver ? 2 : 0], description: row[driver ? 3 : 1] };
}

export function trackingHealth(parcel, position, now = new Date()) {
  const active = !['delivered', 'cancelled'].includes(parcel.status);
  const timestamp = position?.createdAt ? new Date(position.createdAt) : null;
  const age = timestamp ? now - timestamp : Infinity;
  return { lastPositionAt: timestamp, positionFresh: active && age >= 0 && age <= 120000,
    estimatedDeliveryAt: parcel.estimatedDeliveryDate,
    overdue: active && Boolean(parcel.estimatedDeliveryDate && new Date(parcel.estimatedDeliveryDate) < now) };
}

export function repeatData(parcel) {
  // Liste blanche : aucun prix, chauffeur, paiement, média, secret de remise
  // ni statut d'une ancienne livraison ne doit engager le nouvel envoi.
  return Object.fromEntries(['receiverName', 'receiverPhone', 'receiverEmail', 'receiverAddress',
    'departureZoneId', 'arrivalZoneId', 'description', 'type', 'weight', 'isUrgent', 'isInsured']
    .map(key => [key, key === 'weight' ? Number(parcel[key] ?? 0) : parcel[key] ?? '']));
}
