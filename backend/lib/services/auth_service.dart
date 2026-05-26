// lib/services/auth_service.dart
import 'package:procolis_backend/models/user.dart';
import 'package:procolis_backend/services/database_service.dart';
import 'package:uuid/uuid.dart';

import '../utils/jwt_helper.dart';
import 'email_service.dart';

class AuthService {
  final EmailService _emailService;
  final _uuid = Uuid();
  
  // Stockage temporaire des OTP (en production, utiliser Redis)
  final Map<String, Map<String, dynamic>> _otpStorage = {};
  
  AuthService({required EmailService emailService}) : _emailService = emailService;
  
  Future<Map<String, dynamic>> register(Map<String, dynamic> data) async {
    final db = await DatabaseService.getInstance();
    final userId = _uuid.v4();
    
    try {
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
        return {'success': false, 'message': 'Ce numéro de téléphone est déjà utilisé'};
      }
      
      // Créer l'utilisateur avec tous les champs
      await db.connection.execute('''
        INSERT INTO users (
          id, email, phone, full_name, role, pin, address, city, region, 
          vehicle_plate, vehicle_model, vehicle_color, vehicle_year,
          garage_id, driver_status, created_at, updated_at
        )
        VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, \$14, \$15, NOW(), NOW())
      ''', parameters: [
        userId, 
        data['email'], 
        data['phone'], 
        data['fullName'],
        data['role'] ?? 'client', 
        data['pin'] ?? '123456',
        data['address'], 
        data['city'], 
        data['region'],
        data['vehiclePlate'], 
        data['vehicleModel'],
        data['vehicleColor'],
        data['vehicleYear'],
        data['garageId'],
        data['driverStatus'] ?? 'offline'
      ]);
      
      // Récupérer l'utilisateur créé
      final userResult = await db.connection.execute(
        'SELECT * FROM users WHERE id = \$1',
        parameters: [userId],
      );
      
      final user = User.fromDatabaseRow(userResult.first);
      
      return {
        'success': true,
        'message': 'Inscription réussie',
        'userId': userId,
        'user': user.toJson()
      };
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
  
  Future<Map<String, dynamic>> sendOtp(String identifier) async {
    final db = await DatabaseService.getInstance();
    final otp = (100000 + _uuid.v4().hashCode % 900000).toString();
    final expiresAt = DateTime.now().add(Duration(minutes: 5));
    
    try {
      // Vérifier si l'utilisateur existe
      final user = await db.connection.execute(
        'SELECT id, email, phone, full_name FROM users WHERE email = \$1 OR phone = \$1',
        parameters: [identifier],
      );
      
      if (user.isEmpty) {
        return {'success': false, 'message': 'Utilisateur non trouvé'};
      }
      
      final userId = user.first[0] as String;
      final email = user.first[1] as String;
      
      // Stocker l'OTP
      _otpStorage[userId] = {
        'code': otp,
        'expiresAt': expiresAt.toIso8601String(),
        'type': 'login',
        'attempts': 0
      };
      
      // Envoyer l'email
      await _emailService.sendOtpCode(email, otp);
      
      return {
        'success': true,
        'message': 'OTP envoyé',
        'userId': userId
      };
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
  
  Future<Map<String, dynamic>> verifyOtp(String userId, String code, String type) async {
    final stored = _otpStorage[userId];
    
    if (stored == null) {
      return {'success': false, 'message': 'Aucun OTP trouvé. Veuillez demander un nouveau code.'};
    }
    
    // Vérifier les tentatives
    final attempts = stored['attempts'] as int? ?? 0;
    if (attempts >= 3) {
      _otpStorage.remove(userId);
      return {'success': false, 'message': 'Trop de tentatives. Veuillez demander un nouveau code.'};
    }
    
    final expiresAt = DateTime.parse(stored['expiresAt']);
    if (DateTime.now().isAfter(expiresAt)) {
      _otpStorage.remove(userId);
      return {'success': false, 'message': 'OTP expiré. Veuillez demander un nouveau code.'};
    }
    
    if (stored['code'] != code) {
      stored['attempts'] = attempts + 1;
      return {'success': false, 'message': 'Code incorrect. Il vous reste ${2 - attempts} tentative(s).'};
    }
    
    // Générer le token
    final token = JwtHelper.generateToken(userId);
    _otpStorage.remove(userId);
    
    // Récupérer toutes les infos utilisateur
    final db = await DatabaseService.getInstance();
    final userResult = await db.connection.execute(
      'SELECT * FROM users WHERE id = \$1',
      parameters: [userId],
    );
    
    if (userResult.isEmpty) {
      return {'success': false, 'message': 'Utilisateur non trouvé'};
    }
    
    final user = User.fromDatabaseRow(userResult.first);
    
    // Mettre à jour last_login
    await db.connection.execute(
      'UPDATE users SET last_login = NOW() WHERE id = \$1',
      parameters: [userId],
    );
    
    return {
      'success': true,
      'accessToken': token,
      'user': user.toJson()
    };
  }
  
  Future<Map<String, dynamic>> loginWithPin(String pin) async {
    final db = await DatabaseService.getInstance();
    
    try {
      final result = await db.connection.execute(
        'SELECT * FROM users WHERE pin = \$1 AND status = \'active\'',
        parameters: [pin],
      );
      
      if (result.isEmpty) {
        return {'success': false, 'message': 'PIN incorrect ou compte inactif'};
      }
      
      final user = User.fromDatabaseRow(result.first);
      final token = JwtHelper.generateToken(user.id);
      
      // Mettre à jour last_login
      await db.connection.execute(
        'UPDATE users SET last_login = NOW() WHERE id = \$1',
        parameters: [user.id],
      );
      
      return {
        'success': true,
        'accessToken': token,
        'user': user.toJson()
      };
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
  
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
      
      final user = User.fromDatabaseRow(result.first);
      
      return {
        'success': true,
        'user': user.toJson()
      };
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
  
  Future<Map<String, dynamic>> changePin(String userId, String oldPin, String newPin) async {
    final db = await DatabaseService.getInstance();
    
    try {
      // Vérifier l'ancien PIN
      final result = await db.connection.execute(
        'SELECT id FROM users WHERE id = \$1 AND pin = \$2',
        parameters: [userId, oldPin],
      );
      
      if (result.isEmpty) {
        return {'success': false, 'message': 'PIN actuel incorrect'};
      }
      
      // Mettre à jour le nouveau PIN
      await db.connection.execute(
        'UPDATE users SET pin = \$1, updated_at = NOW() WHERE id = \$2',
        parameters: [newPin, userId],
      );
      
      return {
        'success': true,
        'message': 'PIN modifié avec succès'
      };
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
  
  Future<Map<String, dynamic>> resetPin(String email, String newPin) async {
    final db = await DatabaseService.getInstance();
    
    try {
      // Vérifier si l'utilisateur existe
      final result = await db.connection.execute(
        'SELECT id FROM users WHERE email = \$1',
        parameters: [email],
      );
      
      if (result.isEmpty) {
        return {'success': false, 'message': 'Email non trouvé'};
      }
      
      // Réinitialiser le PIN
      await db.connection.execute(
        'UPDATE users SET pin = \$1, updated_at = NOW() WHERE email = \$2',
        parameters: [newPin, email],
      );
      
      return {
        'success': true,
        'message': 'PIN réinitialisé avec succès'
      };
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
}