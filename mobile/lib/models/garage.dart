// mobile/lib/models/garage.dart

class Garage {
  final String id;
  final String name;
  final String city;
  final String region;
  final String? address;
  final String? phone;
  final double? latitude;
  final double? longitude;
  final int driversCount;
  final int parcelsCount;
  final double revenue;
  final String? adminId;
  final String? adminName;
  final String? adminEmail;
  final String? adminPhone;
  final bool isActive;
  final String? createdBy;
  final DateTime createdAt;
  final DateTime updatedAt;

  Garage({
    required this.id,
    required this.name,
    required this.city,
    required this.region,
    this.address,
    this.phone,
    this.latitude,
    this.longitude,
    this.driversCount = 0,
    this.parcelsCount = 0,
    this.revenue = 0,
    this.adminId,
    this.adminName,
    this.adminEmail,
    this.adminPhone,
    this.isActive = true,
    this.createdBy,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Garage.fromJson(Map<String, dynamic> json) {
    int parseInt(dynamic value) {
      if (value == null) return 0;
      if (value is int) return value;
      if (value is double) return value.toInt();
      if (value is String) return int.tryParse(value) ?? 0;
      if (value is num) return value.toInt();
      return 0;
    }

    double parseDouble(dynamic value) {
      if (value == null) return 0.0;
      if (value is double) return value;
      if (value is int) return value.toDouble();
      if (value is String) return double.tryParse(value) ?? 0.0;
      if (value is num) return value.toDouble();
      return 0.0;
    }

    double? parseCoordinate(dynamic value) {
      if (value == null) return null;
      if (value is double) return value;
      if (value is int) return value.toDouble();
      if (value is String) return double.tryParse(value);
      if (value is num) return value.toDouble();
      return null;
    }

    DateTime? parseDateTime(dynamic value) {
      if (value == null) return null;
      try {
        return DateTime.parse(value.toString());
      } catch (e) {
        return null;
      }
    }

    return Garage(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      region: json['region']?.toString() ?? '',
      address: json['address']?.toString(),
      phone: json['phone']?.toString(),
      latitude: parseCoordinate(json['latitude']),
      longitude: parseCoordinate(json['longitude']),
      driversCount: parseInt(json['drivers_count'] ?? json['driversCount']),
      parcelsCount: parseInt(json['parcels_count'] ?? json['parcelsCount']),
      revenue: parseDouble(json['revenue']),
      adminId: json['adminId']?.toString(),
      adminName: json['adminName']?.toString(),
      adminEmail: json['adminEmail']?.toString(),
      adminPhone: json['adminPhone']?.toString(),
      isActive: json['isActive'] ?? true,
      createdBy: json['createdBy']?.toString(),
      createdAt: parseDateTime(json['created_at'] ?? json['createdAt']) ?? DateTime.now(),
      updatedAt: parseDateTime(json['updated_at'] ?? json['updatedAt']) ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'city': city,
    'region': region,
    'address': address,
    'phone': phone,
    'latitude': latitude,
    'longitude': longitude,
    'drivers_count': driversCount,
    'parcels_count': parcelsCount,
    'revenue': revenue,
    'adminId': adminId,
    'adminName': adminName,
    'adminEmail': adminEmail,
    'adminPhone': adminPhone,
    'isActive': isActive,
    'createdBy': createdBy,
    'created_at': createdAt.toIso8601String(),
    'updated_at': updatedAt.toIso8601String(),
  };

  Garage copyWith({
    String? id,
    String? name,
    String? city,
    String? region,
    String? address,
    String? phone,
    double? latitude,
    double? longitude,
    int? driversCount,
    int? parcelsCount,
    double? revenue,
    String? adminId,
    String? adminName,
    String? adminEmail,
    String? adminPhone,
    bool? isActive,
    String? createdBy,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Garage(
      id: id ?? this.id,
      name: name ?? this.name,
      city: city ?? this.city,
      region: region ?? this.region,
      address: address ?? this.address,
      phone: phone ?? this.phone,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      driversCount: driversCount ?? this.driversCount,
      parcelsCount: parcelsCount ?? this.parcelsCount,
      revenue: revenue ?? this.revenue,
      adminId: adminId ?? this.adminId,
      adminName: adminName ?? this.adminName,
      adminEmail: adminEmail ?? this.adminEmail,
      adminPhone: adminPhone ?? this.adminPhone,
      isActive: isActive ?? this.isActive,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}