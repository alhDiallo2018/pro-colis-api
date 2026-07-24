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

export function serializeBid(bid) {
  if (!bid) return null;
  return {
    id: bid.id,
    parcelId: bid.parcelId,
    driverId: bid.driverId,
    driverName: bid.driver?.fullName,
    driverPhone: bid.driver?.phone,
    price: decimalToString(bid.price),
    message: bid.message,
    status: bid.status,
    responseMessage: bid.responseMessage,
    audioUrl: bid.audioUrl,
    respondedAt: dateToIso(bid.respondedAt),
    createdAt: dateToIso(bid.createdAt),
    updatedAt: dateToIso(bid.updatedAt)
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

export function serializeParcel(parcel) {
  if (!parcel) return null;
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
    departureCity: parcel.departureGarage?.city,
    arrivalGarageId: parcel.arrivalGarageId,
    arrivalGarageName: parcel.arrivalGarage?.name,
    arrivalCity: parcel.arrivalGarage?.city,
    driverId: parcel.driverId,
    driverName: parcel.driver?.fullName,
    driverPhone: parcel.driver?.phone,
    driver: serializeUser(parcel.driver),
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
    paymentPhoneNumber: parcel.paymentPhoneNumber,
    paymentStatus: parcel.paymentStatus,
    signatureUrl: parcel.signatureUrl,
    notes: parcel.notes,
    pickupDate: dateToIso(parcel.pickupDate),
    deliveryDate: dateToIso(parcel.deliveryDate),
    estimatedDeliveryDate: dateToIso(parcel.estimatedDeliveryDate),
    createdBy: parcel.createdBy,
    cancelledBy: parcel.cancelledBy,
    cancellationReason: parcel.cancellationReason,
    cancelledAt: dateToIso(parcel.cancelledAt),
    createdAt: dateToIso(parcel.createdAt),
    updatedAt: dateToIso(parcel.updatedAt),
    bids: parcel.bids?.map(serializeBid) || [],
    events: parcel.events?.map(serializeParcelEvent) || [],
    media: parcel.media?.map(serializeMedia) || [],
    photoUrls: parcel.media?.filter((item) => item.mediaType === 'photo').map((item) => item.url) || [],
    videoUrls: parcel.media?.filter((item) => item.mediaType === 'video').map((item) => item.url) || [],
    audioUrls: parcel.media?.filter((item) => item.mediaType === 'audio').map((item) => item.url) || []
  };
}

export function serializePayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    userId: payment.userId,
    parcelId: payment.parcelId,
    trackingNumber: payment.parcel?.trackingNumber,
    amount: decimalToString(payment.amount),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    transactionId: payment.transactionId,
    phoneNumber: payment.phoneNumber,
    reference: payment.reference,
    metadata: payment.metadata,
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

export function serializeAuditLog(log) {
  if (!log) return null;
  return {
    id: log.id,
    actorId: log.actorId,
    actorRole: log.actorRole,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    beforeData: log.beforeData,
    afterData: log.afterData,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    requestId: log.requestId,
    createdAt: dateToIso(log.createdAt)
  };
}
