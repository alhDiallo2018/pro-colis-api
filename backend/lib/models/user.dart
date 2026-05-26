// backend/lib/models/user.dart
import 'package:uuid/uuid.dart';

class User {
  final String id;
  final String email;
  final String phone;
  final String fullName;
  final String? passwordHash;
  final UserRole role;
  final String? pin;
  final String? garageId;
  final String? vehiclePlate;
  final String? vehicleModel;
  final String? vehicleColor;
  final int? vehicleYear;
  final String? address;
  final String? city;
  final String? region;
  final String? driverStatus;
  final String? profilePhotoUrl;
  final UserStatus status;
  final bool isEmailVerified;
  final bool isPhoneVerified;
  final DateTime createdAt;
  final DateTime? lastLogin;
  final DateTime? updatedAt;

  User({
    String? id,
    required this.email,
    required this.phone,
    required this.fullName,
    this.passwordHash,
    required this.role,
    this.pin,
    this.garageId,
    this.vehiclePlate,
    this.vehicleModel,
    this.vehicleColor,
    this.vehicleYear,
    this.address,
    this.city,
    this.region,
    this.driverStatus,
    this.profilePhotoUrl,
    this.status = UserStatus.active,
    this.isEmailVerified = false,
    this.isPhoneVerified = false,
    DateTime? createdAt,
    this.lastLogin,
    this.updatedAt,
  }) : id = id ?? const Uuid().v4(),
       createdAt = createdAt ?? DateTime.now();

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'phone': phone,
    'fullName': fullName,
    'role': role.name,
    'pin': pin,
    'garageId': garageId,
    'vehiclePlate': vehiclePlate,
    'vehicleModel': vehicleModel,
    'vehicleColor': vehicleColor,
    'vehicleYear': vehicleYear,
    'address': address,
    'city': city,
    'region': region,
    'driverStatus': driverStatus,
    'profilePhotoUrl': profilePhotoUrl,
    'status': status.name,
    'isEmailVerified': isEmailVerified,
    'isPhoneVerified': isPhoneVerified,
    'createdAt': createdAt.toIso8601String(),
    'lastLogin': lastLogin?.toIso8601String(),
    'updatedAt': updatedAt?.toIso8601String(),
  };

  factory User.fromJson(Map<String, dynamic> json) => User(
    id: json['id'],
    email: json['email'],
    phone: json['phone'],
    fullName: json['fullName'],
    passwordHash: json['passwordHash'],
    role: UserRole.values.firstWhere((e) => e.name == json['role']),
    pin: json['pin'],
    garageId: json['garageId'],
    vehiclePlate: json['vehiclePlate'],
    vehicleModel: json['vehicleModel'],
    vehicleColor: json['vehicleColor'],
    vehicleYear: json['vehicleYear'],
    address: json['address'],
    city: json['city'],
    region: json['region'],
    driverStatus: json['driverStatus'],
    profilePhotoUrl: json['profilePhotoUrl'],
    status: UserStatus.values.firstWhere((e) => e.name == json['status']),
    isEmailVerified: json['isEmailVerified'] ?? false,
    isPhoneVerified: json['isPhoneVerified'] ?? false,
    createdAt: DateTime.parse(json['createdAt']),
    lastLogin: json['lastLogin'] != null ? DateTime.parse(json['lastLogin']) : null,
    updatedAt: json['updatedAt'] != null ? DateTime.parse(json['updatedAt']) : null,
  );
  
  // Méthode utilitaire pour créer un User à partir d'une ligne de base de données
  factory User.fromDatabaseRow(List<dynamic> row) {
    return User(
      id: row[0] as String,
      email: row[1] as String,
      phone: row[2] as String,
      fullName: row[3] as String,
      passwordHash: row[4] as String?,
      role: UserRole.values.firstWhere(
        (e) => e.name == (row[5] as String? ?? 'client'),
        orElse: () => UserRole.client,
      ),
      status: UserStatus.values.firstWhere(
        (e) => e.name == (row[6] as String? ?? 'active'),
        orElse: () => UserStatus.active,
      ),
      address: row[7] as String?,
      city: row[8] as String?,
      region: row[9] as String?,
      vehiclePlate: row[10] as String?,
      vehicleModel: row[11] as String?,
      driverStatus: row[12] as String?,
      pin: row[13] as String?,
      garageId: row[15] as String?,  // garage_id est à l'index 15 selon votre table
      profilePhotoUrl: row[16] as String?,
      isEmailVerified: row[17] as bool? ?? false,
      isPhoneVerified: row[18] as bool? ?? false,
      createdAt: row[19] as DateTime,
      updatedAt: row[20] as DateTime?,
      lastLogin: row[21] as DateTime?,
    );
  }
}

enum UserRole {
  superAdmin('super_admin'),
  admin('admin'),
  driver('driver'),
  client('client');

  final String name;
  const UserRole(this.name);
}

enum UserStatus {
  active('active'),
  suspended('suspended'),
  deleted('deleted');

  final String name;
  const UserStatus(this.name);
}

// Statut du chauffeur
enum DriverStatus {
  available('available'),
  busy('busy'),
  offline('offline');

  final String name;
  const DriverStatus(this.name);
}