import 'dart:convert';

import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

import '../services/database_service.dart';
import '../services/email_service.dart';

class AuthController {
  final EmailService emailService;
  final _uuid = const Uuid();

  AuthController({required this.emailService});

  Router get router {
    final router = Router();
    
    router.post('/register', _register);
    router.post('/send-otp', _sendOtp);
    router.post('/verify-otp', _verifyOtp);
    
    return router;
  }

  Future<Response> _register(Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      // Validation des champs requis
      final requiredFields = ['email', 'phone', 'fullName', 'password'];
      for (var field in requiredFields) {
        if (data[field] == null || data[field].toString().isEmpty) {
          return Response.badRequest(body: jsonEncode({
            'success': false,
            'message': 'Le champ $field est requis',
          }));
        }
      }
      
      final userId = _uuid.v4();
      final pin = (100000 + DateTime.now().millisecondsSinceEpoch % 900000).toString();
      
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
      
      // Insérer l'utilisateur dans PostgreSQL
      await db.connection.execute('''
        INSERT INTO users (id, email, phone, full_name, password_hash, role, pin, created_at, updated_at)
        VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, NOW(), NOW())
      ''', parameters: [
        userId,
        data['email'],
        data['phone'],
        data['fullName'],
        data['password'],
        'client',
        pin,
      ]);
      
      // Générer et envoyer OTP
      final otpCode = (100000 + DateTime.now().millisecondsSinceEpoch % 900000).toString();
      final expiresAt = DateTime.now().add(const Duration(minutes: 10));
      
      // Stocker l'OTP dans la base de données
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
      
      await emailService.sendOtpCode(data['email'], otpCode, 'verification');
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Compte créé avec succès',
        'userId': userId,
        'pin': pin,
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
        SELECT id, email FROM users WHERE email = \$1 OR phone = \$1
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
        'login',
        expiresAt.toIso8601String(),
      ]);
      
      await emailService.sendOtpCode(email, otpCode, 'login');
      
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
      
      // Gérer le cas où expires_at peut être DateTime ou String
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
      
      // Récupérer l'utilisateur
      final userResult = await db.connection.execute('''
        SELECT id, email, phone, full_name, role, pin, created_at 
        FROM users WHERE id = \$1
      ''', parameters: [userId]);
      
      if (userResult.isEmpty) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      final createdAtValue = userResult.first[6];
      DateTime createdAt;
      if (createdAtValue is DateTime) {
        createdAt = createdAtValue;
      } else if (createdAtValue is String) {
        createdAt = DateTime.parse(createdAtValue);
      } else {
        createdAt = DateTime.now();
      }
      
      final user = {
        'id': userResult.first[0] as String,
        'email': userResult.first[1] as String,
        'phone': userResult.first[2] as String,
        'fullName': userResult.first[3] as String,
        'role': userResult.first[4] as String,
        'pin': userResult.first[5] as String,
        'createdAt': createdAt.toIso8601String(),
      };
      
      print('✅ OTP vérifié avec succès pour user: ${user['email']}');
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Authentification réussie',
        'accessToken': 'token_${user['id']}',
        'refreshToken': 'refresh_${user['id']}',
        'user': user,
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
}