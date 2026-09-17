import { snapshotToCancellation } from './cancellation.js';

function decimalToString(value) {
  if (value === null || value === undefined) {
    return value;
  }

  // Prisma Decimal expose une conversion string fiable, mais l'app mobile
  // consomme ces champs comme des nombres Dart (`num`/`double`).
  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? value.toString() : numericValue;
}

function dateToIso(value) {
  return value ? value.toISOString() : value;
}

export function serializeGarage(garage) {
  if (!garage) return null;
  return {
    id: garage.id,
    name: garage.name,
    city: garage.city,
    region: garage.region,
    address: garage.address,
    phone: garage.phone,
    latitude: decimalToString(garage.latitude),
    longitude: decimalToString(garage.longitude),
    isActive: garage.isActive,
    deletedAt: dateToIso(garage.deletedAt),
    createdAt: dateToIso(garage.createdAt),
    updatedAt: dateToIso(garage.updatedAt)
  };
}

export function serializeUser(user) {
  if (!user) return null;

  // Le vehicule est une relation (table `vehicles`), pas des colonnes de
  // `users`. On l'aplatit ici pour que les clients disposent de la plaque et
  // du modele sans requete supplementaire — a condition que l'appelant ait
  // inclus la relation. Sans include, on n'invente rien : les champs restent
  // absents plutot que faussement vides.
  const vehicle = Array.isArray(user.vehicles) ? user.vehicles[0] : user.vehicle;

  // Meme regle pour la zone de rattachement, qui vit dans `zone_drivers` : sans
  // include le champ reste absent plutot que de repondre "aucune zone". Le lien
  // principal prime, sinon le premier rattachement.
  const zoneLinks = Array.isArray(user.driverZones) ? user.driverZones : null;
  const zoneLink = zoneLinks ? (zoneLinks.find((link) => link.isPrimary) ?? zoneLinks[0]) : null;

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    profilePhoto: user.profilePhoto,
    address: user.address,
    city: user.city,
    region: user.region,
    gender: user.gender,
    garageId: user.garageId,
    garageName: user.garage?.name,
    zoneId: zoneLinks ? (zoneLink?.zoneId ?? null) : undefined,
    zoneName: zoneLink?.zone?.name,
    vehicleId: vehicle?.id,
    vehiclePlate: vehicle?.plateNumber,
    vehicleModel: vehicle?.model,
    vehicleType: vehicle?.type,
    vehicleCapacity: vehicle?.capacity,
    driverStatus: user.driverStatus,
    rating: decimalToString(user.rating),
    totalDeliveries: user.totalDeliveries,
    completedDeliveries: user.completedDeliveries,
    cancelledDeliveries: user.cancelledDeliveries,
    isEmailVerified: user.isEmailVerified,
    isPhoneVerified: user.isPhoneVerified,
    isVerified: user.isVerified ?? false,
    isProfileComplete: user.isProfileComplete,
    lastLogin: dateToIso(user.lastLogin),
    lastActiveAt: dateToIso(user.lastActiveAt),
    createdAt: dateToIso(user.createdAt),
    updatedAt: dateToIso(user.updatedAt)
  };
}

/**
 * DTO public d'un chauffeur (WHITELIST stricte).
 *
 * Concu pour les endpoints publics (`/public/drivers/*`). N'expose jamais les
 * donnees personnelles du chauffeur : pas d'email, de telephone, d'adresse, de
 * genre, de `lastLogin` / `lastActiveAt`, ni aucune donnee de compte, de
 * paiement, de wallet ou de KYC. Seuls les champs necessaires a la mise en
 * relation publique sont presents.
 *
 * `detailed` ajoute les statistiques et la description publique du vehicule
 * (modele / type) pour la fiche publique. La plaque n'est jamais exposee : elle
 * identifie personnellement le chauffeur et ne doit transiter que via un
 * endpoint authentifie une fois la mission engagee.
 */
export function serializePublicDriver(driver, { detailed = false } = {}) {
  if (!driver) return null;

  const base = {
    id: driver.id,
    fullName: driver.fullName,
    profilePhoto: driver.profilePhoto ?? null,
    city: driver.city ?? null,
    region: driver.region ?? null,
    driverStatus: driver.driverStatus ?? null,
    rating: decimalToString(driver.rating),
    completedDeliveries: driver.completedDeliveries ?? 0
  };

  if (!detailed) return base;

  const vehicle = Array.isArray(driver.vehicles) ? driver.vehicles[0] : driver.vehicle;

  return {
    ...base,
    totalDeliveries: driver.totalDeliveries ?? 0,
    vehicleModel: vehicle?.model ?? null,
    vehicleType: vehicle?.type ?? null
  };
}

export function serializeBid(bid) {
  if (!bid) return null;

  // L'historique est optionnel car toutes les requetes Prisma ne chargent pas
  // cette relation. Lorsqu'il est present, on fournit le meme contrat ordonne
  // aux clients web et mobile.
  const negotiationHistory = Array.isArray(bid.negotiationMessages)
    ? bid.negotiationMessages.map((entry) => ({
        id: entry.id,
        fromUserId: entry.fromUserId,
        fromUserRole: entry.fromUserRole,
        price: decimalToString(entry.price),
        message: entry.message,
        createdAt: dateToIso(entry.createdAt)
      }))
    : undefined;

  // Dernier echange de la negociation : les listes affichent le prix courant
  // avec le commentaire qui l'accompagne, sans charger tout l'historique.
  const lastEntry = Array.isArray(bid.negotiationMessages) && bid.negotiationMessages.length
    ? bid.negotiationMessages[bid.negotiationMessages.length - 1]
    : null;

  // `lastOfferBy` dit qui a pose le dernier prix : seul l'autre camp peut
  // accepter. Les encheres anterieures a la colonne partent de l'offre
  // initiale, toujours emise par le chauffeur.
  const lastOfferBy = bid.lastOfferBy || lastEntry?.fromUserRole || 'driver';
  const isOpen = bid.status === 'pending' || bid.status === 'countered';

  return {
    id: bid.id,
    parcelId: bid.parcelId,
    driverId: bid.driverId,
    driverName: bid.driver?.fullName,
    driverPhone: bid.driver?.phone,
    driverRating: decimalToString(bid.driver?.rating ?? null),
    driverCity: bid.driver?.city ?? null,
    driverZoneName: bid.driver?.garage?.name ?? null,
    price: decimalToString(bid.price),
    message: bid.message,
    status: bid.status,
    responseMessage: bid.responseMessage,
    audioUrl: bid.audioUrl,
    respondedAt: dateToIso(bid.respondedAt),
    createdAt: dateToIso(bid.createdAt),
    updatedAt: dateToIso(bid.updatedAt),
    lastOfferBy,
    lastPrice: decimalToString(lastEntry?.price ?? bid.price),
    lastMessage: lastEntry?.message ?? bid.responseMessage ?? bid.message ?? null,
    lastMessageAt: dateToIso(lastEntry?.createdAt ?? bid.respondedAt ?? bid.createdAt),
    canClientAccept: isOpen && lastOfferBy === 'driver',
    canDriverAccept: isOpen && lastOfferBy === 'client',
    ...(negotiationHistory ? { negotiationHistory } : {})
  };
}

/**
 * Representation publique d'une offre (GET /public/parcels/:id/bids).
 *
 * Variante de `serializeBid` dediee aux reponses publiques : elle n'expose
 * jamais `driverPhone` (ni telephone, email ou adresse du chauffeur), ni la
 * ville / zone du chauffeur, ni l'historique de negociation. Le chauffeur ne
 * remonte que sous forme minimale `{ driverId, driverName, driverRating }`.
 */
export function serializePublicBid(bid) {
  if (!bid) return null;

  const lastEntry = Array.isArray(bid.negotiationMessages) && bid.negotiationMessages.length
    ? bid.negotiationMessages[bid.negotiationMessages.length - 1]
    : null;

  const lastOfferBy = bid.lastOfferBy || lastEntry?.fromUserRole || 'driver';
  const isOpen = bid.status === 'pending' || bid.status === 'countered';

  return {
    id: bid.id,
    parcelId: bid.parcelId,
    driverId: bid.driverId,
    driverName: bid.driver?.fullName,
    driverRating: decimalToString(bid.driver?.rating ?? null),
    price: decimalToString(bid.price),
    message: bid.message,
    status: bid.status,
    responseMessage: bid.responseMessage,
    audioUrl: bid.audioUrl,
    respondedAt: dateToIso(bid.respondedAt),
    createdAt: dateToIso(bid.createdAt),
    updatedAt: dateToIso(bid.updatedAt),
    lastOfferBy,
    lastPrice: decimalToString(lastEntry?.price ?? bid.price),
    lastMessage: lastEntry?.message ?? bid.responseMessage ?? bid.message ?? null,
    lastMessageAt: dateToIso(lastEntry?.createdAt ?? bid.respondedAt ?? bid.createdAt),
    canClientAccept: isOpen && lastOfferBy === 'driver',
    canDriverAccept: isOpen && lastOfferBy === 'client'
  };
}

export function serializeDriverLocation(location) {
  if (!location) return null;
  return {
    id: location.id,
    driverId: location.driverId,
    parcelId: location.parcelId,
    latitude: decimalToString(location.latitude),
    longitude: decimalToString(location.longitude),
    accuracy: decimalToString(location.accuracy),
    createdAt: dateToIso(location.createdAt)
  };
}

export function serializeParcelEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    parcelId: event.parcelId,
    status: event.status,
    description: event.description,
    location: event.location,
    locationLat: decimalToString(event.locationLat),
    locationLng: decimalToString(event.locationLng),
    userId: event.userId,
    userName: event.userName,
    userRole: event.userRole,
    photoUrl: event.photoUrl,
    metadata: event.metadata,
    timestamp: dateToIso(event.createdAt),
    createdAt: dateToIso(event.createdAt)
  };
}

/**
 * Normalise un mouvement pour le contrat Flutter. Les montants sont stockes
 * positifs en base, y compris pour certains debits ; le signe est donc derive
 * du solde avant/apres, avec le type comme repli pour les retraits deja geles.
 */
export function serializeDriverWalletTransaction(transaction) {
  if (!transaction) return null;

  const rawAmount = Math.abs(Number(transaction.amount));
  const balanceBefore = Number(transaction.balanceBefore);
  const balanceAfter = Number(transaction.balanceAfter);
  const balanceDelta = balanceAfter - balanceBefore;
  const debitTypes = new Set(['commission', 'penalty', 'withdrawal']);
  const signedAmount = balanceDelta < 0 || (balanceDelta === 0 && debitTypes.has(transaction.type))
    ? -rawAmount
    : rawAmount;

  return {
    id: transaction.id,
    userId: transaction.walletUserId,
    walletId: transaction.walletUserId,
    amount: signedAmount,
    rawAmount,
    type: transaction.type,
    parcelId: transaction.parcelId,
    trackingNumber: transaction.parcel?.trackingNumber || null,
    description: transaction.description || '',
    origin: transaction.origin,
    status: transaction.status,
    balanceBefore,
    balanceAfter,
    performedBy: transaction.performedBy,
    metadata: {
      origin: transaction.origin,
      status: transaction.status,
      balanceBefore,
      balanceAfter
    },
    createdAt: dateToIso(transaction.createdAt)
  };
}

export function serializeMedia(media) {
  if (!media) return null;
  return {
    id: media.id,
    parcelId: media.parcelId,
    uploadedBy: media.uploadedBy,
    mediaType: media.mediaType,
    url: media.url,
    filename: media.filename,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes?.toString(),
    durationSeconds: media.durationSeconds,
    metadata: media.metadata,
    createdAt: dateToIso(media.createdAt)
  };
}

// Proposition directe (le client choisit son chauffeur) : le colis n'est pas
// assigne tant que le chauffeur n'a pas accepte. On expose l'etat, le dernier
// prix et le dernier commentaire pour que les deux camps voient la meme chose.
function serializeParcelProposal(parcel) {
  if (!parcel.proposalStatus && !parcel.proposedDriverId) {
    return { proposal: null };
  }

  const messages = Array.isArray(parcel.negotiationMessages) ? parcel.negotiationMessages : null;
  const lastEntry = messages && messages.length ? messages[messages.length - 1] : null;

  // Sans colonne renseignee : une proposition en attente vient du client, une
  // contre-offre du chauffeur.
  const lastOfferBy =
    parcel.lastOfferBy || lastEntry?.fromUserRole || (parcel.proposalStatus === 'countered' ? 'driver' : 'client');
  const isOpen = parcel.proposalStatus === 'pending' || parcel.proposalStatus === 'countered';

  return {
    proposal: {
      status: parcel.proposalStatus,
      driverId: parcel.proposedDriverId,
      driverName: parcel.proposedDriver?.fullName,
      price: decimalToString(parcel.proposalPrice),
      lastCounterPrice: decimalToString(parcel.lastCounterPrice),
      lastMessage: lastEntry?.message ?? null,
      lastMessageAt: dateToIso(lastEntry?.createdAt),
      lastOfferBy,
      negotiationCount: parcel.negotiationCount ?? 0,
      canClientAccept: isOpen && lastOfferBy === 'driver',
      canDriverAccept: isOpen && lastOfferBy === 'client',
      history: messages
        ? messages.map((entry) => ({
            id: entry.id,
            fromUserId: entry.fromUserId,
            fromUserRole: entry.fromUserRole,
            price: decimalToString(entry.price),
            message: entry.message,
            createdAt: dateToIso(entry.createdAt)
          }))
        : undefined
    },
    proposalStatus: parcel.proposalStatus,
    proposalPrice: decimalToString(parcel.proposalPrice),
    lastCounterPrice: decimalToString(parcel.lastCounterPrice),
    negotiationCount: parcel.negotiationCount ?? 0,
    lastOfferBy
  };
}

export function serializeParcel(parcel, options = {}) {
  if (!parcel) return null;

  // Le chauffeur n'a pas à connaître l'état du paiement du client (ex.
  // « Payé ») ni les coordonnées de paiement qui ne concernent pas sa mission.
  // Ces champs sont donc omis quand la sérialisation cible un chauffeur. Le
  // prix et le canal (espèces / plateforme) restent exposés : ils déterminent
  // la commission et le mode d'encaissement de la mission.
  const redactPayment = options.redactPayment === true;

  const paymentStatus = redactPayment ? undefined : parcel.paymentStatus;
  const paymentPhoneNumber = redactPayment ? undefined : parcel.paymentPhoneNumber;
  const cashCollectedAmount = redactPayment ? undefined : decimalToString(parcel.cashCollectedAmount);
  const cashCollectedAt = redactPayment ? undefined : dateToIso(parcel.cashCollectedAt);

  return {
    id: parcel.id,
    trackingNumber: parcel.trackingNumber,
    senderId: parcel.senderId,
    senderName: parcel.senderName,
    senderPhone: parcel.senderPhone,
    senderEmail: parcel.senderEmail,
    receiverName: parcel.receiverName,
    receiverPhone: parcel.receiverPhone,
    receiverEmail: parcel.receiverEmail,
    receiverAddress: parcel.receiverAddress,
    description: parcel.description,
    weight: decimalToString(parcel.weight),
    length: decimalToString(parcel.length),
    width: decimalToString(parcel.width),
    height: decimalToString(parcel.height),
    type: parcel.type,
    status: parcel.status,
    departureGarageId: parcel.departureGarageId,
    departureGarageName: parcel.departureGarage?.name,
    arrivalGarageId: parcel.arrivalGarageId,
    arrivalGarageName: parcel.arrivalGarage?.name,
    // Référentiel zones, désormais celui du mobile. Les champs garage restent
    // exposés pour les écrans qui n'ont pas migré.
    departureZoneId: parcel.departureZoneId,
    departureZoneName: parcel.departureZone?.name,
    arrivalZoneId: parcel.arrivalZoneId,
    arrivalZoneName: parcel.arrivalZone?.name,
    // Coordonnées des zones : permettent au mobile de calculer une distance
    // réelle au lieu d'afficher une valeur figée.
    departureLatitude: decimalToString(parcel.departureZone?.latitude),
    departureLongitude: decimalToString(parcel.departureZone?.longitude),
    arrivalLatitude: decimalToString(parcel.arrivalZone?.latitude),
    arrivalLongitude: decimalToString(parcel.arrivalZone?.longitude),
    // La ville vient de la zone quand elle existe, du garage sinon : les colis
    // antérieurs à la migration n'ont pas tous de zone rattachée.
    departureCity: parcel.departureZone?.city ?? parcel.departureGarage?.city,
    arrivalCity: parcel.arrivalZone?.city ?? parcel.arrivalGarage?.city,
    // `driver*` reste le chauffeur retenu : la colonne a ete renommee
    // assigned_driver_id, mais les clients publies lisent encore `driverId`.
    driverId: parcel.assignedDriverId,
    driverName: parcel.assignedDriver?.fullName,
    driverPhone: parcel.assignedDriver?.phone,
    driver: serializeUser(parcel.assignedDriver),
    assignedDriverId: parcel.assignedDriverId,
    assignedDriver: serializeUser(parcel.assignedDriver),
    proposedDriverId: parcel.proposedDriverId,
    proposedDriver: serializeUser(parcel.proposedDriver),
    proposedDriverName: parcel.proposedDriver?.fullName,
    price: decimalToString(parcel.price),
    proposedPrice: decimalToString(parcel.proposedPrice),
    negotiatedPrice: decimalToString(parcel.negotiatedPrice),
    deliveryFees: decimalToString(parcel.deliveryFees),
    totalAmount: decimalToString(parcel.totalAmount),
    isInsured: parcel.isInsured,
    insuranceAmount: decimalToString(parcel.insuranceAmount),
    isUrgent: parcel.isUrgent,
    urgentFee: decimalToString(parcel.urgentFee),
    isFreeForBidding: parcel.isFreeForBidding,
    selectedBidId: parcel.selectedBidId,
    paymentMethod: parcel.paymentMethod,
    paymentChannel: parcel.paymentChannel,
    acceptedPaymentChannels: parcel.acceptedPaymentChannels || [],
    cashCollectionPoint: parcel.cashCollectionPoint,
    cashCollectedAmount,
    cashCollectedAt,
    paymentPhoneNumber,
    paymentStatus,
    signatureUrl: parcel.signatureUrl,
    notes: parcel.notes,
    pickupDate: dateToIso(parcel.pickupDate),
    deliveryDate: dateToIso(parcel.deliveryDate),
    estimatedDeliveryDate: dateToIso(parcel.estimatedDeliveryDate),
    createdBy: parcel.createdBy,
    cancelledBy: parcel.cancelledBy,
    cancellationReason: parcel.cancellationReason,
    cancelledAt: dateToIso(parcel.cancelledAt),
    // Conséquences d'annulation calculées par le backend : ré-exposées depuis
    // l'instantané persisté, sans recalcul. `null` quand aucune donnée n'existe.
    cancellation: snapshotToCancellation(parcel.cancellationData, {
      redactDriverFinancials: options.redactDriverFinancials === true,
      redactClientFinancials: options.redactClientFinancials === true || redactPayment
    }),
    createdAt: dateToIso(parcel.createdAt),
    updatedAt: dateToIso(parcel.updatedAt),
    ...serializeParcelProposal(parcel),
    bids: parcel.bids?.map(serializeBid) || [],
    events: parcel.events?.map(serializeParcelEvent) || [],
    media: parcel.media?.map(serializeMedia) || [],
    photoUrls: parcel.media?.filter((item) => item.mediaType === 'photo').map((item) => item.url) || [],
    videoUrls: parcel.media?.filter((item) => item.mediaType === 'video').map((item) => item.url) || [],
    audioUrls: parcel.media?.filter((item) => item.mediaType === 'audio').map((item) => item.url) || []
  };
}

/**
 * Representation dediee au suivi public d'un colis (GET /public/parcels/track).
 *
 * Contrairement a `serializeParcel`, ce serializer n'expose jamais les donnees
 * personnelles du chauffeur : pas de `serializeUser` (email, telephone, adresse,
 * genre, lastLogin, etc.), pas de `driverPhone`, pas de donnees de paiement ou de
 * caisse, et pas d'historique de negociation (offres, propositions). Le chauffeur
 * ne remonte que sous la forme minimale `{ id, name }`.
 */
export function serializePublicTrackingParcel(parcel) {
  if (!parcel) return null;

  const driver = parcel.assignedDriver
    ? { id: parcel.assignedDriver.id, name: parcel.assignedDriver.fullName }
    : null;

  return {
    id: parcel.id,
    trackingNumber: parcel.trackingNumber,
    status: parcel.status,
    senderName: parcel.senderName,
    receiverName: parcel.receiverName,
    receiverAddress: parcel.receiverAddress,
    description: parcel.description,
    type: parcel.type,
    weight: decimalToString(parcel.weight),
    length: decimalToString(parcel.length),
    width: decimalToString(parcel.width),
    height: decimalToString(parcel.height),
    isUrgent: parcel.isUrgent,
    departureGarageId: parcel.departureGarageId,
    departureGarageName: parcel.departureGarage?.name,
    arrivalGarageId: parcel.arrivalGarageId,
    arrivalGarageName: parcel.arrivalGarage?.name,
    departureZoneId: parcel.departureZoneId,
    departureZoneName: parcel.departureZone?.name,
    arrivalZoneId: parcel.arrivalZoneId,
    arrivalZoneName: parcel.arrivalZone?.name,
    departureLatitude: decimalToString(parcel.departureZone?.latitude),
    departureLongitude: decimalToString(parcel.departureZone?.longitude),
    arrivalLatitude: decimalToString(parcel.arrivalZone?.latitude),
    arrivalLongitude: decimalToString(parcel.arrivalZone?.longitude),
    departureCity: parcel.departureZone?.city ?? parcel.departureGarage?.city,
    arrivalCity: parcel.arrivalZone?.city ?? parcel.arrivalGarage?.city,
    driverId: parcel.assignedDriverId,
    driverName: parcel.assignedDriver?.fullName,
    driver,
    assignedDriverId: parcel.assignedDriverId,
    assignedDriver: driver,
    price: decimalToString(parcel.price),
    pickupDate: dateToIso(parcel.pickupDate),
    deliveryDate: dateToIso(parcel.deliveryDate),
    estimatedDeliveryDate: dateToIso(parcel.estimatedDeliveryDate),
    cancellationReason: parcel.cancellationReason,
    cancelledAt: dateToIso(parcel.cancelledAt),
    createdAt: dateToIso(parcel.createdAt),
    updatedAt: dateToIso(parcel.updatedAt),
    events: parcel.events?.map(serializeParcelEvent) || [],
    photoUrls: parcel.media?.filter((item) => item.mediaType === 'photo').map((item) => item.url) || [],
    videoUrls: parcel.media?.filter((item) => item.mediaType === 'video').map((item) => item.url) || [],
    audioUrls: parcel.media?.filter((item) => item.mediaType === 'audio').map((item) => item.url) || []
  };
}

/**
 * Représentation publique d'un colis « libre » (GET /public/parcels/free).
 *
 * Whitelist stricte : aucune donnée permettant de contacter ou d'identifier un
 * utilisateur hors plateforme. Pas de téléphone, d'email, de nom d'expéditeur ou
 * de destinataire, d'adresse, de chauffeur, de paiement ni de négociation. Seuls
 * les champs nécessaires à l'affichage public d'une annonce sont exposés.
 */
export function serializePublicFreeParcel(parcel) {
  if (!parcel) return null;

  return {
    id: parcel.id,
    trackingNumber: parcel.trackingNumber,
    status: parcel.status,
    type: parcel.type,
    description: parcel.description,
    weight: decimalToString(parcel.weight),
    length: decimalToString(parcel.length),
    width: decimalToString(parcel.width),
    height: decimalToString(parcel.height),
    isUrgent: parcel.isUrgent,
    isFreeForBidding: parcel.isFreeForBidding,
    departureGarageId: parcel.departureGarageId,
    departureGarageName: parcel.departureGarage?.name,
    arrivalGarageId: parcel.arrivalGarageId,
    arrivalGarageName: parcel.arrivalGarage?.name,
    departureZoneId: parcel.departureZoneId,
    departureZoneName: parcel.departureZone?.name,
    arrivalZoneId: parcel.arrivalZoneId,
    arrivalZoneName: parcel.arrivalZone?.name,
    departureCity: parcel.departureZone?.city ?? parcel.departureGarage?.city,
    arrivalCity: parcel.arrivalZone?.city ?? parcel.arrivalGarage?.city,
    price: decimalToString(parcel.price),
    pickupDate: dateToIso(parcel.pickupDate),
    estimatedDeliveryDate: dateToIso(parcel.estimatedDeliveryDate),
    createdAt: dateToIso(parcel.createdAt),
    photoUrls: parcel.media?.filter((item) => item.mediaType === 'photo').map((item) => item.url) || [],
    videoUrls: parcel.media?.filter((item) => item.mediaType === 'video').map((item) => item.url) || [],
    audioUrls: parcel.media?.filter((item) => item.mediaType === 'audio').map((item) => item.url) || []
  };
}

export function serializePayment(payment) {
  if (!payment) return null;
  const metadata = payment.metadata && typeof payment.metadata === 'object'
    ? payment.metadata
    : {};

  // Les détails propres à une déclaration cash restent dans metadata en base,
  // mais sont aussi exposés à plat pour un contrat identique sur mobile et web.
  return {
    id: payment.id,
    userId: payment.userId,
    parcelId: payment.parcelId,
    trackingNumber: payment.parcel?.trackingNumber,
    parcel: serializeParcel(payment.parcel),
    amount: decimalToString(payment.amount),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    transactionId: payment.transactionId,
    phoneNumber: payment.phoneNumber,
    reference: payment.reference,
    metadata,
    userName: payment.user?.fullName || metadata.declaredByName,
    channel: metadata.channel || (payment.method === 'cash' ? 'cash' : 'platform'),
    cashCollectionPoint: metadata.cashCollectionPoint,
    declaredBy: metadata.declaredBy,
    declaredByName: metadata.declaredByName,
    declaredAt: metadata.declaredAt,
    declarationNote: metadata.declarationNote,
    declarationProofUrl: metadata.declarationProofUrl,
    rejectionReason: metadata.rejectionReason,
    rejectedAt: metadata.rejectedAt,
    rejectedBy: metadata.rejectedBy,
    receiptUrl: payment.receiptUrl,
    validatedBy: payment.validatedBy,
    validatedAt: dateToIso(payment.validatedAt),
    completedAt: dateToIso(payment.completedAt),
    createdAt: dateToIso(payment.createdAt),
    updatedAt: dateToIso(payment.updatedAt)
  };
}

export function serializeScoreTransaction(transaction) {
  if (!transaction) return null;
  return {
    id: transaction.id,
    userId: transaction.userId,
    amount: transaction.amount,
    type: transaction.type,
    parcelId: transaction.parcelId,
    description: transaction.description,
    status: transaction.status,
    metadata: transaction.metadata,
    timestamp: dateToIso(transaction.createdAt),
    createdAt: dateToIso(transaction.createdAt)
  };
}

export function serializeAdvertisement(advertisement) {
  if (!advertisement) return null;
  return {
    id: advertisement.id,
    driverId: advertisement.driverId,
    driver: serializeUser(advertisement.driver),
    departureGarageId: advertisement.departureGarageId,
    arrivalGarageId: advertisement.arrivalGarageId,
    departureZoneId: advertisement.departureZoneId,
    arrivalZoneId: advertisement.arrivalZoneId,
    departureCity: advertisement.departureCity,
    arrivalCity: advertisement.arrivalCity,
    departureAt: dateToIso(advertisement.departureAt),
    availableWeight: decimalToString(advertisement.availableWeight),
    proposedPrice: decimalToString(advertisement.proposedPrice),
    description: advertisement.description,
    audioUrl: advertisement.audioUrl,
    status: advertisement.status,
    metadata: advertisement.metadata,
    offers: advertisement.offers?.map(serializeAdvertisementOffer) || [],
    createdAt: dateToIso(advertisement.createdAt),
    updatedAt: dateToIso(advertisement.updatedAt)
  };
}

export function serializeAdvertisementOffer(offer) {
  if (!offer) return null;
  return {
    id: offer.id,
    advertisementId: offer.advertisementId,
    clientId: offer.clientId,
    client: serializeUser(offer.client),
    parcelId: offer.parcelId,
    parcel: offer.parcel ? {
      id: offer.parcel.id,
      trackingNumber: offer.parcel.trackingNumber,
      description: offer.parcel.description,
      weight: offer.parcel.weight,
      receiverName: offer.parcel.receiverName,
      receiverPhone: offer.parcel.receiverPhone,
      receiverAddress: offer.parcel.receiverAddress,
      status: offer.parcel.status,
      type: offer.parcel.type,
      photoUrls: offer.parcel.media?.filter((item) => item.mediaType === 'photo').map((item) => item.url) || [],
      videoUrls: offer.parcel.media?.filter((item) => item.mediaType === 'video').map((item) => item.url) || [],
      audioUrls: offer.parcel.media?.filter((item) => item.mediaType === 'audio').map((item) => item.url) || [],
    } : null,
    price: decimalToString(offer.price),
    message: offer.message,
    status: offer.status,
    responseMessage: offer.responseMessage,
    respondedAt: dateToIso(offer.respondedAt),
    createdAt: dateToIso(offer.createdAt),
    updatedAt: dateToIso(offer.updatedAt)
  };
}

/**
 * `detailed` gouverne l'exposition des instantanes avant/apres, qui contiennent
 * des valeurs metier completes. Sans lui, la ligne dit qui a fait quoi, quand
 * et depuis ou, mais pas ce qui a change dans le detail.
 */
export function serializeAuditLog(log, { detailed = true } = {}) {
  if (!log) return null;
  return {
    id: log.id,
    actorId: log.actorId,
    actorRole: log.actorRole,
    actor: log.actor
      ? { id: log.actor.id, fullName: log.actor.fullName, phone: log.actor.phone, role: log.actor.role }
      : null,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    beforeData: detailed ? log.beforeData : undefined,
    afterData: detailed ? log.afterData : undefined,
    hasChangeSnapshot: Boolean(log.beforeData || log.afterData),
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    requestId: log.requestId,
    redacted: !detailed,
    createdAt: dateToIso(log.createdAt)
  };
}
