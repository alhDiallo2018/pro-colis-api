// backend/lib/services/auth_service.dart
// ignore_for_file: unused_local_variable, unused_element

import 'dart:async';

import 'package:procolis_backend/models/user.dart';
import 'package:procolis_backend/services/database_service.dart';
import 'package:procolis_backend/services/notification_service.dart';
import 'package:uuid/uuid.dart';

import '../utils/jwt_helper.dart';
import 'email_service.dart';

class AuthService {
  final EmailService _emailService;
  final _uuid = Uuid();
  late final NotificationService _notificationService;

  // Stockage temporaire des OTP (en production, utiliser Redis)
  final Map<String, Map<String, dynamic>> _otpStorage = {};

  // Mapping des IDs de garage numériques vers des UUIDs valides
  final Map<String, String> _garageUuidMapping = {
    '1': '11111111-1111-1111-1111-111111111111',
    '2': '22222222-2222-2222-2222-222222222222',
    '3': '33333333-3333-3333-3333-333333333333',
    '4': '44444444-4444-4444-4444-444444444444',
    '5': '55555555-5555-5555-5555-555555555555',
  };

  AuthService({required EmailService emailService})
      : _emailService = emailService {
    _notificationService = NotificationService();
  }

  // ==================== MÉTHODES DE CONVERSION DE TYPES ====================

  /// Convertit une valeur en String ou null
  String? _getStringValue(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value == null) return null;
    if (value is String && value.isEmpty) return null;
    if (value is String) return value;
    return value.toString();
  }

  /// Convertit une valeur en int ou null
  int? _getIntValue(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value == null) return null;
    if (value is int) return value;
    if (value is String) {
      if (value.isEmpty) return null;
      return int.tryParse(value);
    }
    if (value is double) return value.toInt();
    if (value is bool) return value ? 1 : 0;
    return null;
  }

  /// Convertit un garage ID en UUID valide
  String? _convertGarageIdToUuid(dynamic garageId) {
    if (garageId == null) return null;

    final garageIdStr = garageId.toString();
    if (garageIdStr.isEmpty) return null;

    // Si c'est déjà un UUID valide
    if (RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            caseSensitive: false)
        .hasMatch(garageIdStr)) {
      return garageIdStr;
    }

    // Si c'est un ID numérique (1,2,3...), utiliser le mapping
    if (_garageUuidMapping.containsKey(garageIdStr)) {
      return _garageUuidMapping[garageIdStr];
    }

    // Sinon, générer un UUID basé sur l'ID
    // ignore: deprecated_member_use
    return _uuid.v5(Uuid.NAMESPACE_DNS, garageIdStr);
  }

  // ==================== FONCTIONS DE CONVERSION POUR LES LIGNES DB ====================

  static String _safeToString(dynamic value) {
    if (value == null) return '';
    return value.toString();
  }

  static String? _safeToStringNullable(dynamic value) {
    if (value == null) return null;
    final str = value.toString();
    return str.isEmpty ? null : str;
  }

  static bool _safeToBool(dynamic value) {
    if (value == null) return false;
    if (value is bool) return value;
    if (value is String) {
      return value.toLowerCase() == 'true' || value == '1';
    }
    if (value is int) return value == 1;
    return false;
  }

  static int? _safeToInt(dynamic value) {
    if (value == null) return null;
    if (value is int) return value;
    if (value is double) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }

  static double? _safeToDouble(dynamic value) {
    if (value == null) return null;
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  static DateTime? _safeToDateTime(dynamic value) {
    if (value == null) return null;
    if (value is DateTime) return value;
    if (value is String) {
      try {
        return DateTime.parse(value);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  static DateTime _safeToDateTimeRequired(dynamic value) {
    if (value == null) return DateTime.now();
    if (value is DateTime) return value;
    if (value is String) {
      try {
        return DateTime.parse(value);
      } catch (_) {
        return DateTime.now();
      }
    }
    return DateTime.now();
  }

  static UserRole _toUserRole(String value) {
    switch (value) {
      case 'super_admin':
        return UserRole.superAdmin;
      case 'admin':
        return UserRole.admin;
      case 'driver':
        return UserRole.driver;
      case 'client':
        return UserRole.client;
      default:
        return UserRole.client;
    }
  }

  static UserStatus _toUserStatus(String value) {
    switch (value) {
      case 'active':
        return UserStatus.active;
      case 'suspended':
        return UserStatus.suspended;
      case 'deleted':
        return UserStatus.deleted;
      default:
        return UserStatus.active;
    }
  }

  // ==================== INSCRIPTION ====================

  Future<Map<String, dynamic>> register(Map<String, dynamic> data) async {
    final db = await DatabaseService.getInstance();
    final userId = _uuid.v4();

    try {
      print('📝 [REGISTER] Données reçues: $data');

      // Vérifier si l'email existe déjà
      final existingUser = await db.connection.execute(
        'SELECT id FROM users WHERE email = \$1',
        parameters: [data['email']],
      );

      if (existingUser.isNotEmpty) {
        return {'success': false, 'message': 'Cet email est déjà utilisé'};
      }

      // Vérifier si le téléphone existe déjà
      final existingPhone = await db.connection.execute(
        'SELECT id FROM users WHERE phone = \$1',
        parameters: [data['phone']],
      );

      if (existingPhone.isNotEmpty) {
        return {
          'success': false,
          'message': 'Ce numéro de téléphone est déjà utilisé'
        };
      }

      // Convertir le garage_id en UUID valide
      final garageUuid = _convertGarageIdToUuid(data['garageId']);
      print(
          '🏢 [REGISTER] Garage ID: ${data['garageId']} -> UUID: $garageUuid');

      // Générer un OTP qui servira de PIN par défaut
      final defaultOtp = (100000 + _uuid.v4().hashCode % 900000).toString();

      // Nettoyer et typer correctement les valeurs
      final address = _getStringValue(data, 'address');
      final city = _getStringValue(data, 'city');
      final region = _getStringValue(data, 'region');
      final vehiclePlate = _getStringValue(data, 'vehiclePlate');
      final vehicleModel = _getStringValue(data, 'vehicleModel');
      final vehicleColor = _getStringValue(data, 'vehicleColor');
      final vehicleYear = _getIntValue(data, 'vehicleYear');
      final role = _getStringValue(data, 'role') ?? 'client';

      print('🏢 [REGISTER] Données traitées:');
      print('   vehiclePlate: $vehiclePlate');
      print('   vehicleModel: $vehicleModel');
      print('   vehicleColor: $vehicleColor');
      print('   vehicleYear: $vehicleYear');
      print('   role: $role');
      print('   OTP/PIN par défaut: $defaultOtp');

      // Créer l'utilisateur avec l'OTP comme PIN par défaut
      await db.connection.execute('''
        INSERT INTO users (
          id, email, phone, full_name, role, pin, 
          address, city, region, 
          vehicle_plate, vehicle_model, vehicle_color, vehicle_year,
          garage_id, created_at, updated_at
        )
        VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, \$14, NOW(), NOW())
      ''', parameters: [
        userId,
        data['email'],
        data['phone'],
        data['fullName'],
        role,
        defaultOtp,
        address,
        city,
        region,
        vehiclePlate,
        vehicleModel,
        vehicleColor,
        vehicleYear,
        garageUuid,
      ]);

      print('✅ [REGISTER] Utilisateur créé avec succès: $userId');

      // Stocker l'OTP pour vérification
      final expiresAt = DateTime.now().add(const Duration(minutes: 10));
      _otpStorage[userId] = {
        'code': defaultOtp,
        'expiresAt': expiresAt.toIso8601String(),
        'type': 'login',
        'attempts': 0
      };

      // Envoyer l'email avec l'OTP (qui est aussi le PIN)
      unawaited(
          _emailService.sendOtpCode(data['email'], defaultOtp).then((success) {
        if (success) {
          print('✅ [REGISTER] Email envoyé avec OTP/PIN: $defaultOtp');
        } else {
          print(
              '⚠️ [REGISTER] Échec envoi email, mais OTP stocké: $defaultOtp');
        }
      }).catchError((error) {
        print('❌ [REGISTER] Erreur envoi email: $error');
      }));

      // NOTIFICATION: Inscription réussie
      await _notificationService.createNotification(
        userId: userId,
        type: 'system',
        title: '🎉 Bienvenue sur PRO COLIS !',
        body: 'Votre compte a été créé avec succès. Utilisez votre PIN pour vous connecter.',
        priority: 'high',
        data: {
          'type': 'registration',
          'role': role,
        },
      );

      // Si l'utilisateur est un chauffeur, notification supplémentaire
      if (role == 'driver') {
        await _notificationService.createNotification(
          userId: userId,
          type: 'system',
          title: '🚚 Profil chauffeur activé',
          body: 'Vous pouvez maintenant accepter des offres et livrer des colis.',
          priority: 'normal',
          data: {
            'type': 'driver_profile_activated',
          },
        );
      }

      // Récupérer l'utilisateur créé
      final userResult = await db.connection.execute(
        'SELECT * FROM users WHERE id = \$1',
        parameters: [userId],
      );

      if (userResult.isEmpty) {
        return {
          'success': false,
          'message': 'Erreur lors de la récupération de l\'utilisateur'
        };
      }

      final row = userResult.first;
      
      // Construction manuelle de l'utilisateur
      final user = User(
        id: _safeToString(row[0]),
        email: _safeToString(row[1]),
        phone: _safeToString(row[2]),
        fullName: _safeToString(row[3]),
        passwordHash: _safeToStringNullable(row[4]),
        role: _toUserRole(_safeToString(row[5])),
        status: _toUserStatus(_safeToString(row[6])),
        address: _safeToStringNullable(row[7]),
        city: _safeToStringNullable(row[8]),
        region: _safeToStringNullable(row[9]),
        vehiclePlate: _safeToStringNullable(row[10]),
        vehicleModel: _safeToStringNullable(row[11]),
        vehicleColor: _safeToStringNullable(row[12]),
        vehicleYear: _safeToInt(row[13]),
        pin: _safeToStringNullable(row[14]),
        garageId: _safeToStringNullable(row[15]),
        garageName: _safeToStringNullable(row[16]),
        profilePhotoUrl: _safeToStringNullable(row[17]),
        isEmailVerified: _safeToBool(row[18]),
        isPhoneVerified: _safeToBool(row[19]),
        isProfileComplete: _safeToBool(row[20]),
        rating: _safeToDouble(row[21]),
        totalDeliveries: _safeToInt(row[22]),
        completedDeliveries: _safeToInt(row[23]),
        cancelledDeliveries: _safeToInt(row[24]),
        gender: _safeToStringNullable(row[25]),
        createdAt: _safeToDateTimeRequired(row[26]),
        updatedAt: _safeToDateTime(row[27]),
        lastLogin: _safeToDateTime(row[28]),
        lastActiveAt: _safeToDateTime(row[29]),
      );

      return {
        'success': true,
        'message':
            'Inscription réussie. Votre code OTP/PIN a été envoyé par email.',
        'userId': userId,
        'user': user.toJson()
      };
    } catch (e) {
      print('❌ [REGISTER] Erreur: $e');
      print('📚 Stack trace: ${StackTrace.current}');
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== ENVOI OTP ====================

  Future<Map<String, dynamic>> sendOtp(String identifier) async {
    final db = await DatabaseService.getInstance();
    final otp = (100000 + _uuid.v4().hashCode % 900000).toString();
    final expiresAt = DateTime.now().add(const Duration(minutes: 5));

    try {
      print('📧 [OTP] Envoi OTP pour: $identifier');

      final user = await db.connection.execute(
        'SELECT id, email, phone, full_name FROM users WHERE email = \$1 OR phone = \$1',
        parameters: [identifier],
      );

      if (user.isEmpty) {
        print('❌ [OTP] Utilisateur non trouvé: $identifier');
        return {'success': false, 'message': 'Utilisateur non trouvé'};
      }

      final userId = _safeToString(user.first[0]);
      final email = _safeToString(user.first[1]);

      print('📧 [OTP] Utilisateur trouvé: $email, OTP: $otp');

      _otpStorage[userId] = {
        'code': otp,
        'expiresAt': expiresAt.toIso8601String(),
        'type': 'login',
        'attempts': 0
      };

      unawaited(_emailService.sendOtpCode(email, otp).then((success) {
        if (success) {
          print('✅ [OTP] Email envoyé avec succès à $email (OTP: $otp)');
        } else {
          print('⚠️ [OTP] Échec envoi email à $email, mais OTP est stocké');
        }
      }).catchError((error) {
        print('❌ [OTP] Erreur lors de l\'envoi email: $error');
      }));

      return {
        'success': true,
        'message': 'OTP envoyé avec succès',
        'userId': userId
      };
    } catch (e) {
      print('❌ [OTP] Erreur: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== VÉRIFICATION OTP ====================

  Future<Map<String, dynamic>> verifyOtp(
      String userId, String code, String type) async {
    print('🔐 [VERIFY] Vérification OTP pour userId: $userId, code: $code');

    final stored = _otpStorage[userId];

    if (stored == null) {
      print('❌ [VERIFY] Aucun OTP trouvé pour userId: $userId');
      return {
        'success': false,
        'message': 'Aucun OTP trouvé. Veuillez demander un nouveau code.'
      };
    }

    final attempts = stored['attempts'] as int? ?? 0;
    if (attempts >= 3) {
      _otpStorage.remove(userId);
      print('❌ [VERIFY] Trop de tentatives pour userId: $userId');
      return {
        'success': false,
        'message': 'Trop de tentatives. Veuillez demander un nouveau code.'
      };
    }

    final expiresAt = DateTime.parse(stored['expiresAt']);
    if (DateTime.now().isAfter(expiresAt)) {
      _otpStorage.remove(userId);
      print('❌ [VERIFY] OTP expiré pour userId: $userId');
      return {
        'success': false,
        'message': 'OTP expiré. Veuillez demander un nouveau code.'
      };
    }

    if (stored['code'] != code) {
      stored['attempts'] = attempts + 1;
      print('❌ [VERIFY] Code incorrect. Tentative ${attempts + 1}/3');
      return {
        'success': false,
        'message': 'Code incorrect. Il vous reste ${2 - attempts} tentative(s).'
      };
    }

    final token = JwtHelper.generateToken(userId);
    _otpStorage.remove(userId);

    print('✅ [VERIFY] OTP validé avec succès pour userId: $userId');

    final db = await DatabaseService.getInstance();
    final userResult = await db.connection.execute(
      'SELECT * FROM users WHERE id = \$1',
      parameters: [userId],
    );

    if (userResult.isEmpty) {
      print('❌ [VERIFY] Utilisateur non trouvé après validation OTP: $userId');
      return {'success': false, 'message': 'Utilisateur non trouvé'};
    }

    final row = userResult.first;
    
    final user = User(
      id: _safeToString(row[0]),
      email: _safeToString(row[1]),
      phone: _safeToString(row[2]),
      fullName: _safeToString(row[3]),
      passwordHash: _safeToStringNullable(row[4]),
      role: _toUserRole(_safeToString(row[5])),
      status: _toUserStatus(_safeToString(row[6])),
      address: _safeToStringNullable(row[7]),
      city: _safeToStringNullable(row[8]),
      region: _safeToStringNullable(row[9]),
      vehiclePlate: _safeToStringNullable(row[10]),
      vehicleModel: _safeToStringNullable(row[11]),
      vehicleColor: _safeToStringNullable(row[12]),
      vehicleYear: _safeToInt(row[13]),
      pin: _safeToStringNullable(row[14]),
      garageId: _safeToStringNullable(row[15]),
      garageName: _safeToStringNullable(row[16]),
      profilePhotoUrl: _safeToStringNullable(row[17]),
      isEmailVerified: _safeToBool(row[18]),
      isPhoneVerified: _safeToBool(row[19]),
      isProfileComplete: _safeToBool(row[20]),
      rating: _safeToDouble(row[21]),
      totalDeliveries: _safeToInt(row[22]),
      completedDeliveries: _safeToInt(row[23]),
      cancelledDeliveries: _safeToInt(row[24]),
      gender: _safeToStringNullable(row[25]),
      createdAt: _safeToDateTimeRequired(row[26]),
      updatedAt: _safeToDateTime(row[27]),
      lastLogin: _safeToDateTime(row[28]),
      lastActiveAt: _safeToDateTime(row[29]),
    );

    await db.connection.execute(
      'UPDATE users SET last_login = NOW() WHERE id = \$1',
      parameters: [userId],
    );

    await _notificationService.createNotification(
      userId: userId,
      type: 'system',
      title: '🔐 Connexion réussie',
      body: 'Vous êtes connecté à PRO COLIS en tant que ${user.fullName}',
      priority: 'normal',
      data: {
        'type': 'login_success',
        'role': user.role.name,
      },
    );

    print('✅ [VERIFY] Utilisateur authentifié: ${user.email}');

    return {'success': true, 'accessToken': token, 'user': user.toJson()};
  }

  // ==================== CONNEXION AVEC PIN ====================

  Future<Map<String, dynamic>> loginWithPin(String pin, String identifier) async {
    final db = await DatabaseService.getInstance();

    try {
      print('🔐 [PIN_LOGIN] Tentative pour: $identifier avec PIN');
      
      final result = await db.connection.execute('''
        SELECT * FROM users 
        WHERE (email = \$1 OR phone = \$1) 
          AND pin = \$2 
          AND status = 'active'
      ''', parameters: [identifier, pin]);

      if (result.isEmpty) {
        print('❌ [PIN_LOGIN] Identifiant ou PIN incorrect');
        return {'success': false, 'message': 'Identifiant ou PIN incorrect'};
      }

      final row = result.first;
      
      final user = User(
        id: _safeToString(row[0]),
        email: _safeToString(row[1]),
        phone: _safeToString(row[2]),
        fullName: _safeToString(row[3]),
        passwordHash: _safeToStringNullable(row[4]),
        role: _toUserRole(_safeToString(row[5])),
        status: _toUserStatus(_safeToString(row[6])),
        address: _safeToStringNullable(row[7]),
        city: _safeToStringNullable(row[8]),
        region: _safeToStringNullable(row[9]),
        vehiclePlate: _safeToStringNullable(row[10]),
        vehicleModel: _safeToStringNullable(row[11]),
        vehicleColor: _safeToStringNullable(row[12]),
        vehicleYear: _safeToInt(row[13]),
        pin: _safeToStringNullable(row[14]),
        garageId: _safeToStringNullable(row[15]),
        garageName: _safeToStringNullable(row[16]),
        profilePhotoUrl: _safeToStringNullable(row[17]),
        isEmailVerified: _safeToBool(row[18]),
        isPhoneVerified: _safeToBool(row[19]),
        isProfileComplete: _safeToBool(row[20]),
        rating: _safeToDouble(row[21]),
        totalDeliveries: _safeToInt(row[22]),
        completedDeliveries: _safeToInt(row[23]),
        cancelledDeliveries: _safeToInt(row[24]),
        gender: _safeToStringNullable(row[25]),
        createdAt: _safeToDateTimeRequired(row[26]),
        updatedAt: _safeToDateTime(row[27]),
        lastLogin: _safeToDateTime(row[28]),
        lastActiveAt: _safeToDateTime(row[29]),
      );

      final token = JwtHelper.generateToken(user.id);

      await db.connection.execute(
        'UPDATE users SET last_login = NOW() WHERE id = \$1',
        parameters: [user.id],
      );

      if (user.isDriver) {
        await _notificationService.createNotification(
          userId: user.id,
          type: 'system',
          title: '🚚 Connecté en tant que chauffeur',
          body: 'Vous êtes maintenant connecté à l\'espace chauffeur PRO COLIS',
          priority: 'normal',
          data: {
            'type': 'driver_login',
            'role': 'driver',
          },
        );
      }

      print('✅ [PIN_LOGIN] Connexion réussie pour: ${user.email}');

      return {
        'success': true, 
        'accessToken': token, 
        'user': user.toJson()
      };
    } catch (e) {
      print('❌ [PIN_LOGIN] Erreur: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== RÉCUPÉRATION UTILISATEUR ====================

  Future<Map<String, dynamic>> getUserById(String userId) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute(
        'SELECT * FROM users WHERE id = \$1',
        parameters: [userId],
      );

      if (result.isEmpty) {
        return {'success': false, 'message': 'Utilisateur non trouvé'};
      }

      final row = result.first;
      
      final user = User(
        id: _safeToString(row[0]),
        email: _safeToString(row[1]),
        phone: _safeToString(row[2]),
        fullName: _safeToString(row[3]),
        passwordHash: _safeToStringNullable(row[4]),
        role: _toUserRole(_safeToString(row[5])),
        status: _toUserStatus(_safeToString(row[6])),
        address: _safeToStringNullable(row[7]),
        city: _safeToStringNullable(row[8]),
        region: _safeToStringNullable(row[9]),
        vehiclePlate: _safeToStringNullable(row[10]),
        vehicleModel: _safeToStringNullable(row[11]),
        vehicleColor: _safeToStringNullable(row[12]),
        vehicleYear: _safeToInt(row[13]),
        pin: _safeToStringNullable(row[14]),
        garageId: _safeToStringNullable(row[15]),
        garageName: _safeToStringNullable(row[16]),
        profilePhotoUrl: _safeToStringNullable(row[17]),
        isEmailVerified: _safeToBool(row[18]),
        isPhoneVerified: _safeToBool(row[19]),
        isProfileComplete: _safeToBool(row[20]),
        rating: _safeToDouble(row[21]),
        totalDeliveries: _safeToInt(row[22]),
        completedDeliveries: _safeToInt(row[23]),
        cancelledDeliveries: _safeToInt(row[24]),
        gender: _safeToStringNullable(row[25]),
        createdAt: _safeToDateTimeRequired(row[26]),
        updatedAt: _safeToDateTime(row[27]),
        lastLogin: _safeToDateTime(row[28]),
        lastActiveAt: _safeToDateTime(row[29]),
      );

      return {'success': true, 'user': user.toJson()};
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== CHANGEMENT DE PIN ====================

  Future<Map<String, dynamic>> changePin(
      String userId, String oldPin, String newPin) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute(
        'SELECT id FROM users WHERE id = \$1 AND pin = \$2',
        parameters: [userId, oldPin],
      );

      if (result.isEmpty) {
        return {'success': false, 'message': 'PIN actuel incorrect'};
      }

      await db.connection.execute(
        'UPDATE users SET pin = \$1, updated_at = NOW() WHERE id = \$2',
        parameters: [newPin, userId],
      );

      await _notificationService.createNotification(
        userId: userId,
        type: 'system',
        title: '🔐 PIN modifié avec succès',
        body: 'Votre PIN a été modifié. N\'oubliez pas de le garder confidentiel.',
        priority: 'high',
        data: {
          'type': 'pin_changed',
        },
      );

      return {'success': true, 'message': 'PIN modifié avec succès'};
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== RÉINITIALISATION PIN ====================

  Future<Map<String, dynamic>> resetPin(String email, String newPin) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute(
        'SELECT id FROM users WHERE email = \$1',
        parameters: [email],
      );

      if (result.isEmpty) {
        return {'success': false, 'message': 'Email non trouvé'};
      }

      final userId = _safeToString(result.first[0]);

      await db.connection.execute(
        'UPDATE users SET pin = \$1, updated_at = NOW() WHERE email = \$2',
        parameters: [newPin, email],
      );

      await _notificationService.createNotification(
        userId: userId,
        type: 'system',
        title: '🔐 PIN réinitialisé',
        body: 'Votre PIN a été réinitialisé. Utilisez le nouveau PIN pour vous connecter.',
        priority: 'urgent',
        data: {
          'type': 'pin_reset',
          'email': email,
        },
      );

      return {'success': true, 'message': 'PIN réinitialisé avec succès'};
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MOT DE PASSE OUBLIÉ ====================

  Future<Map<String, dynamic>> forgotPassword(String email) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute(
        'SELECT id, full_name FROM users WHERE email = \$1 AND status = \'active\'',
        parameters: [email],
      );

      if (result.isEmpty) {
        return {'success': false, 'message': 'Email non trouvé ou compte inactif'};
      }

      final userId = _safeToString(result.first[0]);
      final fullName = _safeToString(result.first[1]);

      await _notificationService.createNotification(
        userId: userId,
        type: 'system',
        title: '🔐 Demande de réinitialisation de PIN',
        body: 'Une demande de réinitialisation de PIN a été effectuée pour votre compte. Si vous n\'êtes pas à l\'origine de cette demande, veuillez contacter le support immédiatement.',
        priority: 'urgent',
        data: {
          'type': 'pin_reset_requested',
          'email': email,
        },
      );

      return {
        'success': true,
        'message': 'Un email de réinitialisation a été envoyé',
      };
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
}