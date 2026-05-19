// mobile/lib/models/parcel.dart
import 'package:flutter/material.dart';

enum ParcelStatus {
  pending('pending', 'En attente', Colors.orange),
  confirmed('confirmed', 'Confirmé', Colors.blue),
  pickedUp('picked_up', 'Ramassé', Colors.purple),
  inTransit('in_transit', 'En transit', Colors.indigo),
  arrived('arrived', 'Arrivé', Colors.teal),
  outForDelivery('out_for_delivery', 'En livraison', Colors.lightBlue),
  delivered('delivered', 'Livré', Colors.green),
  cancelled('cancelled', 'Annulé', Colors.red);

  final String value;
  final String label;
  final Color color;
  const ParcelStatus(this.value, this.label, this.color);

  static ParcelStatus fromString(String value) {
    return ParcelStatus.values.firstWhere(
      (e) => e.value == value,
      orElse: () => ParcelStatus.pending,
    );
  }
}

enum ParcelType {
  document('document', 'Documents', Icons.description),
  package('package', 'Colis standard', Icons.inventory),
  fragile('fragile', 'Fragile', Icons.warning),
  perishable('perishable', 'Périssable', Icons.food_bank),
  valuable('valuable', 'Valeur', Icons.attach_money);

  final String value;
  final String label;
  final IconData icon;
  const ParcelType(this.value, this.label, this.icon);

  static ParcelType fromString(String value) {
    return ParcelType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => ParcelType.package,
    );
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
  final String? paymentMethod;
  final String? paymentStatus;
  final List<String> photoUrls;
  final String? signatureUrl;
  final bool isInsured;
  final double? insuranceAmount;
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
    this.signatureUrl,
    this.isInsured = false,
    this.insuranceAmount,
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

  factory Parcel.fromMinimalJson(Map<String, dynamic> json) {
    return Parcel(
      id: json['id']?.toString() ?? '',
      trackingNumber: json['trackingNumber']?.toString() ?? '',
      senderId: json['senderId']?.toString() ?? '',
      senderName: json['senderName']?.toString() ?? '',
      senderPhone: json['senderPhone']?.toString() ?? '',
      receiverName: json['receiverName']?.toString() ?? '',
      receiverPhone: json['receiverPhone']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      weight: (json['weight'] ?? 0).toDouble(),
      type: json['type'] != null ? ParcelType.fromString(json['type'].toString()) : ParcelType.package,
      status: json['status'] != null ? ParcelStatus.fromString(json['status'].toString()) : ParcelStatus.pending,
      departureGarageId: json['departureGarageId']?.toString() ?? '',
      departureGarageName: json['departureGarageName']?.toString() ?? '',
      createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt'].toString()) : DateTime.now(),
    );
  }

  factory Parcel.fromJson(Map<String, dynamic> json) {
    String? parseString(dynamic value) => value?.toString();
    double? parseDouble(dynamic value) => value != null ? (value is double ? value : double.tryParse(value.toString())) : null;
    DateTime? parseDateTime(dynamic value) => value != null ? DateTime.tryParse(value.toString()) : null;

    return Parcel(
      id: parseString(json['id']) ?? '',
      trackingNumber: parseString(json['trackingNumber']) ?? '',
      senderId: parseString(json['senderId']) ?? '',
      senderName: parseString(json['senderName']) ?? '',
      senderPhone: parseString(json['senderPhone']) ?? '',
      receiverName: parseString(json['receiverName']) ?? '',
      receiverPhone: parseString(json['receiverPhone']) ?? '',
      receiverEmail: parseString(json['receiverEmail']),
      receiverAddress: parseString(json['receiverAddress']),
      description: parseString(json['description']) ?? '',
      weight: parseDouble(json['weight']) ?? 0,
      length: parseDouble(json['length']),
      width: parseDouble(json['width']),
      height: parseDouble(json['height']),
      type: json['type'] != null ? ParcelType.fromString(parseString(json['type'])!) : ParcelType.package,
      status: json['status'] != null ? ParcelStatus.fromString(parseString(json['status'])!) : ParcelStatus.pending,
      departureGarageId: parseString(json['departureGarageId']) ?? '',
      departureGarageName: parseString(json['departureGarageName']) ?? '',
      arrivalGarageId: parseString(json['arrivalGarageId']),
      arrivalGarageName: parseString(json['arrivalGarageName']),
      driverId: parseString(json['driverId']),
      driverName: parseString(json['driverName']),
      driverPhone: parseString(json['driverPhone']),
      price: parseDouble(json['price']),
      deliveryFees: parseDouble(json['deliveryFees']),
      totalAmount: parseDouble(json['totalAmount']),
      paymentMethod: parseString(json['paymentMethod']),
      paymentStatus: parseString(json['paymentStatus']),
      photoUrls: json['photoUrls'] != null ? List<String>.from(json['photoUrls']) : [],
      signatureUrl: parseString(json['signatureUrl']),
      isInsured: json['isInsured'] ?? false,
      insuranceAmount: parseDouble(json['insuranceAmount']),
      notes: parseString(json['notes']),
      pickupDate: parseDateTime(json['pickupDate']),
      deliveryDate: parseDateTime(json['deliveryDate']),
      estimatedDeliveryDate: parseDateTime(json['estimatedDeliveryDate']),
      createdAt: parseDateTime(json['createdAt']) ?? DateTime.now(),
      updatedAt: parseDateTime(json['updatedAt']),
      createdBy: parseString(json['createdBy']),
      cancelledBy: parseString(json['cancelledBy']),
      cancellationReason: parseString(json['cancellationReason']),
      cancelledAt: parseDateTime(json['cancelledAt']),
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
    'paymentMethod': paymentMethod,
    'paymentStatus': paymentStatus,
    'photoUrls': photoUrls,
    'signatureUrl': signatureUrl,
    'isInsured': isInsured,
    'insuranceAmount': insuranceAmount,
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

  // Propriétés calculées
  bool get isPending => status == ParcelStatus.pending;
  bool get isConfirmed => status == ParcelStatus.confirmed;
  bool get isPickedUp => status == ParcelStatus.pickedUp;
  bool get isInTransit => status == ParcelStatus.inTransit;
  bool get isArrived => status == ParcelStatus.arrived;
  bool get isOutForDelivery => status == ParcelStatus.outForDelivery;
  bool get isDelivered => status == ParcelStatus.delivered;
  bool get isCancelled => status == ParcelStatus.cancelled;
  
  bool get isInProgress => status == ParcelStatus.confirmed || 
                            status == ParcelStatus.pickedUp || 
                            status == ParcelStatus.inTransit || 
                            status == ParcelStatus.arrived || 
                            status == ParcelStatus.outForDelivery;
  
  bool get isFinished => status == ParcelStatus.delivered || status == ParcelStatus.cancelled;
  
  bool get hasDriver => driverId != null && driverId!.isNotEmpty;
  
  bool get isPaid => paymentStatus == 'completed' || paymentStatus == 'paid';
  
  String get formattedWeight => '${weight.toStringAsFixed(1)} kg';
  
  String get formattedPrice => '${price?.toStringAsFixed(0) ?? 0} FCFA';
  
  String get formattedTotal => '${totalAmount?.toStringAsFixed(0) ?? price?.toStringAsFixed(0) ?? 0} FCFA';
  
  double get volume {
    if (length == null || width == null || height == null) return 0;
    return length! * width! * height! / 1000000; // en m³
  }

  Parcel copyWith({
    String? id,
    String? trackingNumber,
    String? senderId,
    String? senderName,
    String? senderPhone,
    String? receiverName,
    String? receiverPhone,
    String? receiverEmail,
    String? receiverAddress,
    String? description,
    double? weight,
    double? length,
    double? width,
    double? height,
    ParcelType? type,
    ParcelStatus? status,
    String? departureGarageId,
    String? departureGarageName,
    String? arrivalGarageId,
    String? arrivalGarageName,
    String? driverId,
    String? driverName,
    String? driverPhone,
    double? price,
    double? deliveryFees,
    double? totalAmount,
    String? paymentMethod,
    String? paymentStatus,
    List<String>? photoUrls,
    String? signatureUrl,
    bool? isInsured,
    double? insuranceAmount,
    String? notes,
    DateTime? pickupDate,
    DateTime? deliveryDate,
    DateTime? estimatedDeliveryDate,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? createdBy,
    String? cancelledBy,
    String? cancellationReason,
    DateTime? cancelledAt,
  }) {
    return Parcel(
      id: id ?? this.id,
      trackingNumber: trackingNumber ?? this.trackingNumber,
      senderId: senderId ?? this.senderId,
      senderName: senderName ?? this.senderName,
      senderPhone: senderPhone ?? this.senderPhone,
      receiverName: receiverName ?? this.receiverName,
      receiverPhone: receiverPhone ?? this.receiverPhone,
      receiverEmail: receiverEmail ?? this.receiverEmail,
      receiverAddress: receiverAddress ?? this.receiverAddress,
      description: description ?? this.description,
      weight: weight ?? this.weight,
      length: length ?? this.length,
      width: width ?? this.width,
      height: height ?? this.height,
      type: type ?? this.type,
      status: status ?? this.status,
      departureGarageId: departureGarageId ?? this.departureGarageId,
      departureGarageName: departureGarageName ?? this.departureGarageName,
      arrivalGarageId: arrivalGarageId ?? this.arrivalGarageId,
      arrivalGarageName: arrivalGarageName ?? this.arrivalGarageName,
      driverId: driverId ?? this.driverId,
      driverName: driverName ?? this.driverName,
      driverPhone: driverPhone ?? this.driverPhone,
      price: price ?? this.price,
      deliveryFees: deliveryFees ?? this.deliveryFees,
      totalAmount: totalAmount ?? this.totalAmount,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      photoUrls: photoUrls ?? this.photoUrls,
      signatureUrl: signatureUrl ?? this.signatureUrl,
      isInsured: isInsured ?? this.isInsured,
      insuranceAmount: insuranceAmount ?? this.insuranceAmount,
      notes: notes ?? this.notes,
      pickupDate: pickupDate ?? this.pickupDate,
      deliveryDate: deliveryDate ?? this.deliveryDate,
      estimatedDeliveryDate: estimatedDeliveryDate ?? this.estimatedDeliveryDate,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      createdBy: createdBy ?? this.createdBy,
      cancelledBy: cancelledBy ?? this.cancelledBy,
      cancellationReason: cancellationReason ?? this.cancellationReason,
      cancelledAt: cancelledAt ?? this.cancelledAt,
    );
  }
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
      id: json['id']?.toString() ?? '',
      parcelId: json['parcelId']?.toString() ?? '',
      status: json['status'] != null ? ParcelStatus.fromString(json['status'].toString()) : ParcelStatus.pending,
      description: json['description']?.toString() ?? '',
      location: json['location']?.toString(),
      locationLat: json['locationLat']?.toString(),
      locationLng: json['locationLng']?.toString(),
      userId: json['userId']?.toString(),
      userName: json['userName']?.toString(),
      userRole: json['userRole']?.toString(),
      photoUrl: json['photoUrl']?.toString(),
      timestamp: json['timestamp'] != null ? DateTime.parse(json['timestamp'].toString()) : DateTime.now(),
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