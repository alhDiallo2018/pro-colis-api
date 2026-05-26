import 'dart:convert';

import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

import '../models/user.dart';
import '../services/database_service.dart';
import '../services/email_service.dart';
import '../utils/jwt_helper.dart';

class AuthController {
  final EmailService emailService;
  final _uuid = const Uuid();

  AuthController({required this.emailService});

  Router get router {
    final router = Router();
    
    router.post('/register', _register);
    router.post('/send-otp', _sendOtp);
    router.post('/verify-otp', _verifyOtp);
    router.post('/login-with-pin', _loginWithPin);
    router.post('/change-pin', _changePin);
    router.post('/forgot-pin', _forgotPin);
    router.get('/me/:userId', _getUser);
    
    return router;
  }

  Future<Response> _register(Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      // Validation des champs requis
      final requiredFields = ['email', 'phone', 'fullName'];
      for (var field in requiredFields) {
        if (data[field] == null || data[field].toString().isEmpty) {
          return Response.badRequest(body: jsonEncode({
            'success': false,
            'message': 'Le champ $field est requis',
          }));
        }
      }
      
      final userId = _uuid.v4();
      // Générer un PIN par défaut (l'utilisateur pourra le changer)
      final defaultPin = (100000 + DateTime.now().millisecondsSinceEpoch % 900000).toString();
      
      final db = await DatabaseService.getInstance();
      
      // Vérifier si l'utilisateur existe déjà
      final existingUser = await db.connection.execute(
        'SELECT id FROM users WHERE email = \$1 OR phone = \$2',
        parameters: [data['email'], data['phone']],
      );
      
      if (existingUser.isNotEmpty) {
        return Response(409, body: jsonEncode({
          'success': false,
          'message': 'Un utilisateur avec cet email ou téléphone existe déjà',
        }));
      }
      
      // Insérer l'utilisateur avec TOUS les champs
      await db.connection.execute('''
        INSERT INTO users (
          id, email, phone, full_name, password_hash, role, status, pin,
          address, city, region, country,
          vehicle_plate, vehicle_model, vehicle_color, vehicle_year,
          driver_status, gender, garage_id, profile_photo,
          is_email_verified, is_phone_verified,
          birth_date, national_id, emergency_contact, emergency_phone,
          fcm_token, is_approved, approved_by, approved_at,
          created_by, created_at, updated_at
        )
        VALUES (
          \$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8,
          \$9, \$10, \$11, \$12,
          \$13, \$14, \$15, \$16,
          \$17, \$18, \$19, \$20,
          \$21, \$22,
          \$23, \$24, \$25, \$26,
          \$27, \$28, \$29, \$30,
          \$31, NOW(), NOW()
        )
      ''', parameters: [
        userId,
        data['email'],
        data['phone'],
        data['fullName'],
        data['password'] ?? null,
        data['role'] ?? 'client',
        data['status'] ?? 'active',
        data['pin'] ?? defaultPin,
        data['address'],
        data['city'],
        data['region'],
        data['country'] ?? 'Sénégal',
        data['vehiclePlate'],
        data['vehicleModel'],
        data['vehicleColor'],
        data['vehicleYear'],
        data['driverStatus'] ?? 'offline',
        data['gender'],
        data['garageId'],
        data['profilePhoto'],
        data['isEmailVerified'] ?? false,
        data['isPhoneVerified'] ?? false,
        data['birthDate'],
        data['nationalId'],
        data['emergencyContact'],
        data['emergencyPhone'],
        data['fcmToken'],
        data['isApproved'] ?? false,
        data['approvedBy'],
        data['approvedAt'],
        data['createdBy'],
      ]);
      
      // Générer et envoyer OTP si besoin
      if (data['sendOtp'] == true) {
        final otpCode = (100000 + DateTime.now().millisecondsSinceEpoch % 900000).toString();
        final expiresAt = DateTime.now().add(const Duration(minutes: 10));
        
        await db.connection.execute('''
          INSERT INTO otps (id, user_id, code, type, expires_at, created_at)
          VALUES (\$1, \$2, \$3, \$4, \$5, NOW())
        ''', parameters: [
          _uuid.v4(),
          userId,
          otpCode,
          'verification',
          expiresAt.toIso8601String(),
        ]);
        
        await emailService.sendOtpCode(data['email'], otpCode);
      }
      
      // Récupérer l'utilisateur créé
      final userResult = await db.connection.execute(
        'SELECT * FROM users WHERE id = \$1',
        parameters: [userId],
      );
      
      final user = User.fromDatabaseRow(userResult.first);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Compte créé avec succès',
        'userId': userId,
        'pin': data['pin'] ?? defaultPin,
        'user': user.toJson(),
      }));
    } catch (e) {
      print('❌ Erreur inscription: $e');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de l\'inscription: $e',
      }));
    }
  }

  Future<Response> _sendOtp(Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      final identifier = data['identifier'];
      
      final db = await DatabaseService.getInstance();
      
      // Chercher l'utilisateur par email ou téléphone
      final result = await db.connection.execute('''
        SELECT id, email, phone, full_name FROM users WHERE email = \$1 OR phone = \$1
      ''', parameters: [identifier]);
      
      if (result.isEmpty) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      final userId = result.first[0] as String;
      final email = result.first[1] as String;
      
      final otpCode = (100000 + DateTime.now().millisecondsSinceEpoch % 900000).toString();
      final expiresAt = DateTime.now().add(const Duration(minutes: 10));
      
      // Supprimer les anciens OTP
      await db.connection.execute(
        'DELETE FROM otps WHERE user_id = \$1',
        parameters: [userId],
      );
      
      // Stocker le nouvel OTP
      await db.connection.execute('''
        INSERT INTO otps (id, user_id, code, type, expires_at, created_at)
        VALUES (\$1, \$2, \$3, \$4, \$5, NOW())
      ''', parameters: [
        _uuid.v4(),
        userId,
        otpCode,
        data['type'] ?? 'login',
        expiresAt.toIso8601String(),
      ]);
      
      await emailService.sendOtpCode(email, otpCode);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Code OTP envoyé',
        'userId': userId,
      }));
    } catch (e) {
      print('❌ Erreur envoi OTP: $e');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de l\'envoi: $e',
      }));
    }
  }

  Future<Response> _verifyOtp(Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      final userId = data['userId'];
      final code = data['code'];
      
      print('🔐 Vérification OTP - UserId: $userId, Code: $code');
      
      final db = await DatabaseService.getInstance();
      
      // Récupérer l'OTP
      final otpResult = await db.connection.execute('''
        SELECT code, expires_at, attempts FROM otps 
        WHERE user_id = \$1 
        ORDER BY created_at DESC 
        LIMIT 1
      ''', parameters: [userId]);
      
      if (otpResult.isEmpty) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'Aucun code OTP trouvé',
        }));
      }
      
      final storedCode = otpResult.first[0] as String;
      final expiresAtValue = otpResult.first[1];
      int attempts = otpResult.first[2] as int;
      
      DateTime expiresAt;
      if (expiresAtValue is DateTime) {
        expiresAt = expiresAtValue;
      } else if (expiresAtValue is String) {
        expiresAt = DateTime.parse(expiresAtValue);
      } else {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'Format de date invalide',
        }));
      }
      
      print('🔐 Stored code: $storedCode, Expires at: $expiresAt, Attempts: $attempts');
      
      if (DateTime.now().isAfter(expiresAt)) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'Le code OTP a expiré',
        }));
      }
      
      if (attempts >= 5) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'Trop de tentatives',
        }));
      }
      
      if (storedCode != code) {
        attempts++;
        await db.connection.execute(
          'UPDATE otps SET attempts = \$1 WHERE user_id = \$2',
          parameters: [attempts, userId],
        );
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'Code OTP incorrect',
        }));
      }
      
      // Supprimer l'OTP utilisé
      await db.connection.execute(
        'DELETE FROM otps WHERE user_id = \$1',
        parameters: [userId],
      );
      
      // Récupérer l'utilisateur complet
      final userResult = await db.connection.execute(
        'SELECT * FROM users WHERE id = \$1',
        parameters: [userId],
      );
      
      if (userResult.isEmpty) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      final user = User.fromDatabaseRow(userResult.first);
      
      // Marquer l'utilisateur comme vérifié si type verification
      if (data['type'] == 'verification') {
        await db.connection.execute('''
          UPDATE users SET is_email_verified = TRUE WHERE id = \$1
        ''', parameters: [userId]);
      }
      
      // Générer le token JWT
      final token = JwtHelper.generateToken(userId);
      
      // Mettre à jour last_login
      await db.connection.execute(
        'UPDATE users SET last_login = NOW() WHERE id = \$1',
        parameters: [userId],
      );
      
      print('✅ OTP vérifié avec succès pour user: ${user.email}');
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Authentification réussie',
        'accessToken': token,
        'refreshToken': 'refresh_${user.id}',
        'user': user.toJson(),
      }));
    } catch (e) {
      print('❌ Erreur vérification OTP: $e');
      print('Stack trace: ${StackTrace.current}');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la vérification: $e',
      }));
    }
  }

  Future<Response> _loginWithPin(Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      final pin = data['pin'];
      
      if (pin == null || pin.toString().isEmpty) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'Le PIN est requis',
        }));
      }
      
      final db = await DatabaseService.getInstance();
      
      final result = await db.connection.execute(
        'SELECT * FROM users WHERE pin = \$1 AND status = \'active\'',
        parameters: [pin],
      );
      
      if (result.isEmpty) {
        return Response(401, body: jsonEncode({
          'success': false,
          'message': 'PIN incorrect ou compte inactif',
        }));
      }
      
      final user = User.fromDatabaseRow(result.first);
      final token = JwtHelper.generateToken(user.id);
      
      // Mettre à jour last_login
      await db.connection.execute(
        'UPDATE users SET last_login = NOW() WHERE id = \$1',
        parameters: [user.id],
      );
      
      // Mettre à jour last_active
      await db.connection.execute(
        'UPDATE users SET last_active = NOW() WHERE id = \$1',
        parameters: [user.id],
      );
      
      return Response.ok(jsonEncode({
        'success': true,
        'accessToken': token,
        'user': user.toJson(),
      }));
    } catch (e) {
      print('❌ Erreur login PIN: $e');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la connexion: $e',
      }));
    }
  }

  Future<Response> _changePin(Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      final userId = data['userId'];
      final oldPin = data['oldPin'];
      final newPin = data['newPin'];
      
      if (userId == null || oldPin == null || newPin == null) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'userId, oldPin et newPin sont requis',
        }));
      }
      
      final db = await DatabaseService.getInstance();
      
      // Vérifier l'ancien PIN
      final result = await db.connection.execute(
        'SELECT id FROM users WHERE id = \$1 AND pin = \$2',
        parameters: [userId, oldPin],
      );
      
      if (result.isEmpty) {
        return Response(401, body: jsonEncode({
          'success': false,
          'message': 'PIN actuel incorrect',
        }));
      }
      
      // Mettre à jour le nouveau PIN
      await db.connection.execute(
        'UPDATE users SET pin = \$1, updated_at = NOW() WHERE id = \$2',
        parameters: [newPin, userId],
      );
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'PIN modifié avec succès',
      }));
    } catch (e) {
      print('❌ Erreur changement PIN: $e');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors du changement de PIN: $e',
      }));
    }
  }

  Future<Response> _forgotPin(Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      final email = data['email'];
      
      if (email == null || email.toString().isEmpty) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'L\'email est requis',
        }));
      }
      
      final db = await DatabaseService.getInstance();
      
      // Vérifier si l'utilisateur existe
      final result = await db.connection.execute(
        'SELECT id, email, full_name FROM users WHERE email = \$1',
        parameters: [email],
      );
      
      if (result.isEmpty) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Email non trouvé',
        }));
      }
      
      final userId = result.first[0] as String;
      final userName = result.first[2] as String;
      
      // Générer un nouveau PIN temporaire
      final newPin = (100000 + DateTime.now().millisecondsSinceEpoch % 900000).toString();
      
      // Mettre à jour le PIN
      await db.connection.execute(
        'UPDATE users SET pin = \$1, updated_at = NOW() WHERE id = \$2',
        parameters: [newPin, userId],
      );
      
      // Envoyer le nouveau PIN par email
      final message = 'Bonjour $userName,\n\nVotre nouveau PIN de connexion est: $newPin\n\nVeuillez le changer après votre prochaine connexion.\n\nCordialement,\nL\'équipe ProColis';
      await emailService.sendOtpCode(email, message);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Un nouveau PIN a été envoyé à votre email',
      }));
    } catch (e) {
      print('❌ Erreur forgot PIN: $e');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la réinitialisation: $e',
      }));
    }
  }

  Future<Response> _getUser(Request request) async {
    try {
      final userId = request.params['userId'];
      
      if (userId == null) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'userId est requis',
        }));
      }
      
      final db = await DatabaseService.getInstance();
      
      final result = await db.connection.execute('''
        SELECT 
          u.id, u.email, u.phone, u.full_name, u.role, u.status,
          u.address, u.city, u.region, u.country,
          u.vehicle_plate, u.vehicle_model, u.vehicle_color, u.vehicle_year,
          u.driver_status, u.pin, u.gender, u.garage_id,
          g.name AS garage_name, u.profile_photo,
          u.is_email_verified, u.is_phone_verified,
          u.birth_date, u.national_id, u.emergency_contact, u.emergency_phone,
          u.fcm_token, u.is_approved, u.approved_by, u.approved_at,
          u.created_by, u.created_at, u.updated_at, u.last_login, u.last_active
        FROM users u
        LEFT JOIN garages g ON g.id = u.garage_id
        WHERE u.id = \$1
      ''', parameters: [userId]);
      
      if (result.isEmpty) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      final user = User.fromDatabaseRow(result.first);
      
      return Response.ok(jsonEncode({
        'success': true,
        'user': user.toJson(),
      }));
    } catch (e) {
      print('❌ Erreur getUser: $e');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }
}