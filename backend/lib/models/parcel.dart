// backend/lib/models/parcel.dart


enum ParcelStatus {
  pending,
  confirmed,
  pickedUp,
  inTransit,
  arrived,
  outForDelivery,
  delivered,
  cancelled;

  String get value {
    switch (this) {
      case ParcelStatus.pending:
        return 'pending';
      case ParcelStatus.confirmed:
        return 'confirmed';
      case ParcelStatus.pickedUp:
        return 'picked_up';
      case ParcelStatus.inTransit:
        return 'in_transit';
      case ParcelStatus.arrived:
        return 'arrived';
      case ParcelStatus.outForDelivery:
        return 'out_for_delivery';
      case ParcelStatus.delivered:
        return 'delivered';
      case ParcelStatus.cancelled:
        return 'cancelled';
    }
  }

  static ParcelStatus fromString(String value) {
    switch (value) {
      case 'pending':
        return ParcelStatus.pending;
      case 'confirmed':
        return ParcelStatus.confirmed;
      case 'picked_up':
        return ParcelStatus.pickedUp;
      case 'in_transit':
        return ParcelStatus.inTransit;
      case 'arrived':
        return ParcelStatus.arrived;
      case 'out_for_delivery':
        return ParcelStatus.outForDelivery;
      case 'delivered':
        return ParcelStatus.delivered;
      case 'cancelled':
        return ParcelStatus.cancelled;
      default:
        return ParcelStatus.pending;
    }
  }
}

enum ParcelType {
  document,
  package,
  fragile,
  perishable,
  valuable;

  String get value {
    switch (this) {
      case ParcelType.document:
        return 'document';
      case ParcelType.package:
        return 'package';
      case ParcelType.fragile:
        return 'fragile';
      case ParcelType.perishable:
        return 'perishable';
      case ParcelType.valuable:
        return 'valuable';
    }
  }

  static ParcelType fromString(String value) {
    switch (value) {
      case 'document':
        return ParcelType.document;
      case 'package':
        return ParcelType.package;
      case 'fragile':
        return ParcelType.fragile;
      case 'perishable':
        return ParcelType.perishable;
      case 'valuable':
        return ParcelType.valuable;
      default:
        return ParcelType.package;
    }
  }
}

enum PaymentMethod {
  cash,
  orangeMoney,
  wave,
  freeMoney;

  String get value {
    switch (this) {
      case PaymentMethod.cash:
        return 'cash';
      case PaymentMethod.orangeMoney:
        return 'orange_money';
      case PaymentMethod.wave:
        return 'wave';
      case PaymentMethod.freeMoney:
        return 'free_money';
    }
  }

  static PaymentMethod fromString(String value) {
    switch (value) {
      case 'cash':
        return PaymentMethod.cash;
      case 'orange_money':
        return PaymentMethod.orangeMoney;
      case 'wave':
        return PaymentMethod.wave;
      case 'free_money':
        return PaymentMethod.freeMoney;
      default:
        return PaymentMethod.cash;
    }
  }
}

class Parcel {
  final String id;
  final String trackingNumber;
  final String senderId;
  final String senderName;
  final String senderPhone;
  final String receiverName;
  final String receiverPhone;
  final String? receiverEmail;
  final String? receiverAddress;
  final String description;
  final double weight;
  final double? length;
  final double? width;
  final double? height;
  final ParcelType type;
  final ParcelStatus status;
  final String departureGarageId;
  final String departureGarageName;
  final String? arrivalGarageId;
  final String? arrivalGarageName;
  final String? driverId;
  final String? driverName;
  final String? driverPhone;
  final double? price;
  final double? deliveryFees;
  final double? totalAmount;
  final PaymentMethod? paymentMethod;
  final String? paymentStatus;
  final List<String> photoUrls;
  final List<String> videoUrls;
  final String? signatureUrl;
  final bool isInsured;
  final double? insuranceAmount;
  final bool isUrgent;
  final double? urgentFee;
  final String? notes;
  final DateTime? pickupDate;
  final DateTime? deliveryDate;
  final DateTime? estimatedDeliveryDate;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String? createdBy;
  final String? cancelledBy;
  final String? cancellationReason;
  final DateTime? cancelledAt;

  Parcel({
    required this.id,
    required this.trackingNumber,
    required this.senderId,
    required this.senderName,
    required this.senderPhone,
    required this.receiverName,
    required this.receiverPhone,
    this.receiverEmail,
    this.receiverAddress,
    required this.description,
    required this.weight,
    this.length,
    this.width,
    this.height,
    required this.type,
    required this.status,
    required this.departureGarageId,
    required this.departureGarageName,
    this.arrivalGarageId,
    this.arrivalGarageName,
    this.driverId,
    this.driverName,
    this.driverPhone,
    this.price,
    this.deliveryFees,
    this.totalAmount,
    this.paymentMethod,
    this.paymentStatus,
    this.photoUrls = const [],
    this.videoUrls = const [],
    this.signatureUrl,
    this.isInsured = false,
    this.insuranceAmount,
    this.isUrgent = false,
    this.urgentFee,
    this.notes,
    this.pickupDate,
    this.deliveryDate,
    this.estimatedDeliveryDate,
    required this.createdAt,
    this.updatedAt,
    this.createdBy,
    this.cancelledBy,
    this.cancellationReason,
    this.cancelledAt,
  });

  factory Parcel.fromJson(Map<String, dynamic> json) {
    return Parcel(
      id: json['id'].toString(),
      trackingNumber: json['tracking_number'].toString(),
      senderId: json['sender_id'].toString(),
      senderName: json['sender_name'].toString(),
      senderPhone: json['sender_phone'].toString(),
      receiverName: json['receiver_name'].toString(),
      receiverPhone: json['receiver_phone'].toString(),
      receiverEmail: json['receiver_email']?.toString(),
      receiverAddress: json['receiver_address']?.toString(),
      description: json['description'].toString(),
      weight: (json['weight'] as num).toDouble(),
      length: json['length'] != null ? (json['length'] as num).toDouble() : null,
      width: json['width'] != null ? (json['width'] as num).toDouble() : null,
      height: json['height'] != null ? (json['height'] as num).toDouble() : null,
      type: ParcelType.fromString(json['type'].toString()),
      status: ParcelStatus.fromString(json['status'].toString()),
      departureGarageId: json['departure_garage_id'].toString(),
      departureGarageName: json['departure_garage_name'].toString(),
      arrivalGarageId: json['arrival_garage_id']?.toString(),
      arrivalGarageName: json['arrival_garage_name']?.toString(),
      driverId: json['driver_id']?.toString(),
      driverName: json['driver_name']?.toString(),
      driverPhone: json['driver_phone']?.toString(),
      price: json['price'] != null ? (json['price'] as num).toDouble() : null,
      deliveryFees: json['delivery_fees'] != null ? (json['delivery_fees'] as num).toDouble() : null,
      totalAmount: json['total_amount'] != null ? (json['total_amount'] as num).toDouble() : null,
      paymentMethod: json['payment_method'] != null ? PaymentMethod.fromString(json['payment_method'].toString()) : null,
      paymentStatus: json['payment_status']?.toString(),
      photoUrls: json['photo_urls'] != null ? List<String>.from(json['photo_urls']) : [],
      videoUrls: json['video_urls'] != null ? List<String>.from(json['video_urls']) : [],
      signatureUrl: json['signature_url']?.toString(),
      isInsured: json['is_insured'] ?? false,
      insuranceAmount: json['insurance_amount'] != null ? (json['insurance_amount'] as num).toDouble() : null,
      isUrgent: json['is_urgent'] ?? false,
      urgentFee: json['urgent_fee'] != null ? (json['urgent_fee'] as num).toDouble() : null,
      notes: json['notes']?.toString(),
      pickupDate: json['pickup_date'] != null ? DateTime.parse(json['pickup_date'].toString()) : null,
      deliveryDate: json['delivery_date'] != null ? DateTime.parse(json['delivery_date'].toString()) : null,
      estimatedDeliveryDate: json['estimated_delivery_date'] != null ? DateTime.parse(json['estimated_delivery_date'].toString()) : null,
      createdAt: DateTime.parse(json['created_at'].toString()),
      updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at'].toString()) : null,
      createdBy: json['created_by']?.toString(),
      cancelledBy: json['cancelled_by']?.toString(),
      cancellationReason: json['cancellation_reason']?.toString(),
      cancelledAt: json['cancelled_at'] != null ? DateTime.parse(json['cancelled_at'].toString()) : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'trackingNumber': trackingNumber,
    'senderId': senderId,
    'senderName': senderName,
    'senderPhone': senderPhone,
    'receiverName': receiverName,
    'receiverPhone': receiverPhone,
    'receiverEmail': receiverEmail,
    'receiverAddress': receiverAddress,
    'description': description,
    'weight': weight,
    'length': length,
    'width': width,
    'height': height,
    'type': type.value,
    'status': status.value,
    'departureGarageId': departureGarageId,
    'departureGarageName': departureGarageName,
    'arrivalGarageId': arrivalGarageId,
    'arrivalGarageName': arrivalGarageName,
    'driverId': driverId,
    'driverName': driverName,
    'driverPhone': driverPhone,
    'price': price,
    'deliveryFees': deliveryFees,
    'totalAmount': totalAmount,
    'paymentMethod': paymentMethod?.value,
    'paymentStatus': paymentStatus,
    'photoUrls': photoUrls,
    'videoUrls': videoUrls,
    'signatureUrl': signatureUrl,
    'isInsured': isInsured,
    'insuranceAmount': insuranceAmount,
    'isUrgent': isUrgent,
    'urgentFee': urgentFee,
    'notes': notes,
    'pickupDate': pickupDate?.toIso8601String(),
    'deliveryDate': deliveryDate?.toIso8601String(),
    'estimatedDeliveryDate': estimatedDeliveryDate?.toIso8601String(),
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt?.toIso8601String(),
    'createdBy': createdBy,
    'cancelledBy': cancelledBy,
    'cancellationReason': cancellationReason,
    'cancelledAt': cancelledAt?.toIso8601String(),
  };
}

class ParcelEvent {
  final String id;
  final String parcelId;
  final ParcelStatus status;
  final String description;
  final String? location;
  final String? locationLat;
  final String? locationLng;
  final String? userId;
  final String? userName;
  final String? userRole;
  final String? photoUrl;
  final DateTime timestamp;

  ParcelEvent({
    required this.id,
    required this.parcelId,
    required this.status,
    required this.description,
    this.location,
    this.locationLat,
    this.locationLng,
    this.userId,
    this.userName,
    this.userRole,
    this.photoUrl,
    required this.timestamp,
  });

  factory ParcelEvent.fromJson(Map<String, dynamic> json) {
    return ParcelEvent(
      id: json['id'].toString(),
      parcelId: json['parcel_id'].toString(),
      status: ParcelStatus.fromString(json['status'].toString()),
      description: json['description'].toString(),
      location: json['location']?.toString(),
      locationLat: json['location_lat']?.toString(),
      locationLng: json['location_lng']?.toString(),
      userId: json['user_id']?.toString(),
      userName: json['user_name']?.toString(),
      userRole: json['user_role']?.toString(),
      photoUrl: json['photo_url']?.toString(),
      timestamp: DateTime.parse(json['created_at'].toString()),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'parcelId': parcelId,
    'status': status.value,
    'description': description,
    'location': location,
    'locationLat': locationLat,
    'locationLng': locationLng,
    'userId': userId,
    'userName': userName,
    'userRole': userRole,
    'photoUrl': photoUrl,
    'timestamp': timestamp.toIso8601String(),
  };
}