// mobile/lib/models/user.dart
import 'package:flutter/material.dart';

enum UserRole {
  client('client', 'Client', Icons.person, Colors.green),
  driver('driver', 'Chauffeur', Icons.delivery_dining, Colors.blue),
  admin('admin', 'Admin Garage', Icons.business, Colors.orange),
  superAdmin('super_admin', 'Super Admin', Icons.admin_panel_settings, Colors.red);

  final String value;
  final String label;
  final IconData icon;
  final Color color;
  const UserRole(this.value, this.label, this.icon, this.color);

  static UserRole fromString(String value) {
    return UserRole.values.firstWhere(
      (e) => e.value == value,
      orElse: () => UserRole.client,
    );
  }
}

enum UserStatus {
  active('active', 'Actif', Colors.green),
  suspended('suspended', 'Suspendu', Colors.orange),
  blocked('blocked', 'Bloqué', Colors.red);

  final String value;
  final String label;
  final Color color;
  const UserStatus(this.value, this.label, this.color);
}

enum DriverStatus {
  available('available', 'Disponible', Colors.green),
  busy('busy', 'En course', Colors.orange),
  offline('offline', 'Hors ligne', Colors.red);

  final String value;
  final String label;
  final Color color;
  const DriverStatus(this.value, this.label, this.color);
}

enum Gender {
  male('male', 'Homme', Icons.male),
  female('female', 'Femme', Icons.female),
  other('other', 'Autre', Icons.person);

  final String value;
  final String label;
  final IconData icon;
  const Gender(this.value, this.label, this.icon);
}

class User {
  final String id;
  final String email;
  final String phone;
  final String fullName;
  final UserRole role;
  final UserStatus status;
  final String? profilePhoto;
  final String? address;
  final String? city;
  final String? region;
  final String? country;
  final String? garageId;
  final String? garageName;
  final String? vehiclePlate;
  final String? vehicleModel;
  final String? vehicleColor;
  final int? vehicleYear;
  final DriverStatus? driverStatus;
  final Gender? gender;
  final DateTime? birthDate;
  final String? nationalId;
  final String? emergencyContact;
  final String? emergencyPhone;
  final String? fcmToken;
  final bool hasPin;
  final bool isEmailVerified;
  final bool isPhoneVerified;
  final bool isApproved;
  final String? approvedBy;
  final DateTime? approvedAt;
  final String? createdBy;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final DateTime? lastLogin;
  final DateTime? lastActive;

  User({
    required this.id,
    required this.email,
    required this.phone,
    required this.fullName,
    required this.role,
    this.status = UserStatus.active,
    this.profilePhoto,
    this.address,
    this.city,
    this.region,
    this.country = 'Sénégal',
    this.garageId,
    this.garageName,
    this.vehiclePlate,
    this.vehicleModel,
    this.vehicleColor,
    this.vehicleYear,
    this.driverStatus,
    this.gender,
    this.birthDate,
    this.nationalId,
    this.emergencyContact,
    this.emergencyPhone,
    this.fcmToken,
    this.hasPin = false,
    this.isEmailVerified = false,
    this.isPhoneVerified = false,
    this.isApproved = false,
    this.approvedBy,
    this.approvedAt,
    this.createdBy,
    required this.createdAt,
    this.updatedAt,
    this.lastLogin,
    this.lastActive,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    DateTime? parseDateTime(dynamic value) {
      if (value == null) return null;
      try {
        return DateTime.parse(value.toString());
      } catch (e) {
        return null;
      }
    }

    return User(
      id: json['id']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      fullName: json['fullName']?.toString() ?? '',
      role: json['role'] != null ? UserRole.fromString(json['role'].toString()) : UserRole.client,
      status: json['status'] != null 
          ? UserStatus.values.firstWhere(
              (e) => e.value == json['status'].toString(),
              orElse: () => UserStatus.active,
            )
          : UserStatus.active,
      profilePhoto: json['profilePhoto']?.toString(),
      address: json['address']?.toString(),
      city: json['city']?.toString(),
      region: json['region']?.toString(),
      country: json['country']?.toString() ?? 'Sénégal',
      garageId: json['garageId']?.toString(),
      garageName: json['garageName']?.toString(),
      vehiclePlate: json['vehiclePlate']?.toString(),
      vehicleModel: json['vehicleModel']?.toString(),
      vehicleColor: json['vehicleColor']?.toString(),
      vehicleYear: json['vehicleYear'] != null ? int.tryParse(json['vehicleYear'].toString()) : null,
      driverStatus: json['driverStatus'] != null 
          ? DriverStatus.values.firstWhere(
              (e) => e.value == json['driverStatus'].toString(),
              orElse: () => DriverStatus.offline,
            )
          : null,
      gender: json['gender'] != null
          ? Gender.values.firstWhere(
              (e) => e.value == json['gender'].toString(),
              orElse: () => Gender.other,
            )
          : null,
      birthDate: parseDateTime(json['birthDate']),
      nationalId: json['nationalId']?.toString(),
      emergencyContact: json['emergencyContact']?.toString(),
      emergencyPhone: json['emergencyPhone']?.toString(),
      fcmToken: json['fcmToken']?.toString(),
      hasPin: json['hasPin'] ?? false,
      isEmailVerified: json['isEmailVerified'] ?? false,
      isPhoneVerified: json['isPhoneVerified'] ?? false,
      isApproved: json['isApproved'] ?? false,
      approvedBy: json['approvedBy']?.toString(),
      approvedAt: parseDateTime(json['approvedAt']),
      createdBy: json['createdBy']?.toString(),
      createdAt: parseDateTime(json['createdAt']) ?? DateTime.now(),
      updatedAt: parseDateTime(json['updatedAt']),
      lastLogin: parseDateTime(json['lastLogin']),
      lastActive: parseDateTime(json['lastActive']),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'phone': phone,
    'fullName': fullName,
    'role': role.value,
    'status': status.value,
    'profilePhoto': profilePhoto,
    'address': address,
    'city': city,
    'region': region,
    'country': country,
    'garageId': garageId,
    'garageName': garageName,
    'vehiclePlate': vehiclePlate,
    'vehicleModel': vehicleModel,
    'vehicleColor': vehicleColor,
    'vehicleYear': vehicleYear,
    'driverStatus': driverStatus?.value,
    'gender': gender?.value,
    'birthDate': birthDate?.toIso8601String(),
    'nationalId': nationalId,
    'emergencyContact': emergencyContact,
    'emergencyPhone': emergencyPhone,
    'fcmToken': fcmToken,
    'hasPin': hasPin,
    'isEmailVerified': isEmailVerified,
    'isPhoneVerified': isPhoneVerified,
    'isApproved': isApproved,
    'approvedBy': approvedBy,
    'approvedAt': approvedAt?.toIso8601String(),
    'createdBy': createdBy,
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt?.toIso8601String(),
    'lastLogin': lastLogin?.toIso8601String(),
    'lastActive': lastActive?.toIso8601String(),
  };

  // Propriétés calculées
  bool get isActive => status == UserStatus.active;
  bool get isSuspended => status == UserStatus.suspended;
  bool get isBlocked => status == UserStatus.blocked;
  
  bool get isSuperAdmin => role == UserRole.superAdmin;
  bool get isAdmin => role == UserRole.admin;
  bool get isDriver => role == UserRole.driver;
  bool get isClient => role == UserRole.client;
  
  bool get canManageUsers => isSuperAdmin;
  bool get canManageGarages => isSuperAdmin;
  bool get canManageDrivers => isSuperAdmin || isAdmin;
  bool get canViewAllParcels => isSuperAdmin || isAdmin;
  bool get canDeliverParcels => isDriver;
  bool get canCreateParcels => isClient;
  
  bool get isDriverAvailable => isDriver && driverStatus == DriverStatus.available;
  bool get isDriverBusy => isDriver && driverStatus == DriverStatus.busy;
  bool get isDriverOffline => isDriver && driverStatus == DriverStatus.offline;
  
  String get initials {
    final parts = fullName.split(' ');
    if (parts.length >= 2) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return fullName.isNotEmpty ? fullName[0].toUpperCase() : '?';
  }

  User copyWith({
    String? id,
    String? email,
    String? phone,
    String? fullName,
    UserRole? role,
    UserStatus? status,
    String? profilePhoto,
    String? address,
    String? city,
    String? region,
    String? country,
    String? garageId,
    String? garageName,
    String? vehiclePlate,
    String? vehicleModel,
    String? vehicleColor,
    int? vehicleYear,
    DriverStatus? driverStatus,
    Gender? gender,
    DateTime? birthDate,
    String? nationalId,
    String? emergencyContact,
    String? emergencyPhone,
    String? fcmToken,
    bool? hasPin,
    bool? isEmailVerified,
    bool? isPhoneVerified,
    bool? isApproved,
    String? approvedBy,
    DateTime? approvedAt,
    String? createdBy,
    DateTime? createdAt,
    DateTime? updatedAt,
    DateTime? lastLogin,
    DateTime? lastActive,
  }) {
    return User(
      id: id ?? this.id,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      fullName: fullName ?? this.fullName,
      role: role ?? this.role,
      status: status ?? this.status,
      profilePhoto: profilePhoto ?? this.profilePhoto,
      address: address ?? this.address,
      city: city ?? this.city,
      region: region ?? this.region,
      country: country ?? this.country,
      garageId: garageId ?? this.garageId,
      garageName: garageName ?? this.garageName,
      vehiclePlate: vehiclePlate ?? this.vehiclePlate,
      vehicleModel: vehicleModel ?? this.vehicleModel,
      vehicleColor: vehicleColor ?? this.vehicleColor,
      vehicleYear: vehicleYear ?? this.vehicleYear,
      driverStatus: driverStatus ?? this.driverStatus,
      gender: gender ?? this.gender,
      birthDate: birthDate ?? this.birthDate,
      nationalId: nationalId ?? this.nationalId,
      emergencyContact: emergencyContact ?? this.emergencyContact,
      emergencyPhone: emergencyPhone ?? this.emergencyPhone,
      fcmToken: fcmToken ?? this.fcmToken,
      hasPin: hasPin ?? this.hasPin,
      isEmailVerified: isEmailVerified ?? this.isEmailVerified,
      isPhoneVerified: isPhoneVerified ?? this.isPhoneVerified,
      isApproved: isApproved ?? this.isApproved,
      approvedBy: approvedBy ?? this.approvedBy,
      approvedAt: approvedAt ?? this.approvedAt,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      lastLogin: lastLogin ?? this.lastLogin,
      lastActive: lastActive ?? this.lastActive,
    );
  }
}