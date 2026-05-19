// backend/lib/models/garage.dart
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
    required this.createdAt,
    required this.updatedAt,
  });

  factory Garage.fromJson(Map<String, dynamic> json) {
    return Garage(
      id: json['id'] as String,
      name: json['name'] as String,
      city: json['city'] as String,
      region: json['region'] as String,
      address: json['address'] as String?,
      phone: json['phone'] as String?,
      latitude: json['latitude'] != null ? (json['latitude'] as num).toDouble() : null,
      longitude: json['longitude'] != null ? (json['longitude'] as num).toDouble() : null,
      driversCount: json['drivers_count'] as int? ?? 0,
      parcelsCount: json['parcels_count'] as int? ?? 0,
      revenue: json['revenue'] != null ? (json['revenue'] as num).toDouble() : 0,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
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
    'created_at': createdAt.toIso8601String(),
    'updated_at': updatedAt.toIso8601String(),
  };
}