// lib/routes/auth_routes.dart
import 'dart:convert';

import 'package:procolis_backend/services/database_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../services/auth_service.dart';
import '../services/email_service.dart';
import '../services/user_service.dart';
import '../utils/jwt_helper.dart';

class AuthRoutes {
  final AuthService _authService;
  final UserService _userService = UserService();

  AuthRoutes({required EmailService emailService})
      : _authService = AuthService(emailService: emailService);

  Router get router {
    final router = Router();

    // Route d'inscription
    router.post('/register', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final result = await _authService.register(data);
        return Response.ok(jsonEncode(result));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Envoi OTP
    router.post('/send-otp', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final result = await _authService.sendOtp(data['identifier']);
        return Response.ok(jsonEncode(result));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Vérification OTP
    router.post('/verify-otp', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final result = await _authService.verifyOtp(
            data['userId'], data['code'], data['type']);
        return Response.ok(jsonEncode(result));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Login avec PIN
    router.post('/login-with-pin', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final result = await _authService.loginWithPin(data['pin']);
        return Response.ok(jsonEncode(result));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Récupérer l'utilisateur connecté (après authentification)
    router.get('/me', (Request request) async {
      final userId = JwtHelper.extractUserId(request);
      if (userId == null) {
        return Response.forbidden(
            jsonEncode({'success': false, 'message': 'Non authentifié'}));
      }

      try {
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
          return Response.notFound(jsonEncode(
              {'success': false, 'message': 'Utilisateur non trouvé'}));
        }

        final row = result.first;

        DateTime? toDate(dynamic v) {
          if (v == null) return null;
          if (v is DateTime) return v;
          return DateTime.tryParse(v.toString());
        }

        final user = {
          'id': row[0],
          'email': row[1],
          'phone': row[2],
          'fullName': row[3],
          'role': row[4],
          'status': row[5],
          'address': row[6] ?? '',
          'city': row[7] ?? '',
          'region': row[8] ?? '',
          'country': row[9] ?? 'Sénégal',
          'vehiclePlate': row[10] ?? '',
          'vehicleModel': row[11] ?? '',
          'vehicleColor': row[12] ?? '',
          'vehicleYear': row[13],
          'driverStatus': row[14],
          'pin': row[15],
          'gender': row[16],
          'garageId': row[17],
          'garageName': row[18],
          'profilePhoto': row[19],
          'isEmailVerified': row[20] ?? false,
          'isPhoneVerified': row[21] ?? false,
          'birthDate': toDate(row[22])?.toIso8601String(),
          'nationalId': row[23],
          'emergencyContact': row[24],
          'emergencyPhone': row[25],
          'fcmToken': row[26],
          'isApproved': row[27] ?? false,
          'approvedBy': row[28],
          'approvedAt': toDate(row[29])?.toIso8601String(),
          'createdBy': row[30],
          'createdAt': toDate(row[31])?.toIso8601String(),
          'updatedAt': toDate(row[32])?.toIso8601String(),
          'lastLogin': toDate(row[33])?.toIso8601String(),
          'lastActive': toDate(row[34])?.toIso8601String(),
        };

        print('✅ Utilisateur chargé: ${user['email']}');

        return Response.ok(jsonEncode({'success': true, 'user': user}));
      } catch (e) {
        print('❌ Erreur /auth/me: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Mettre à jour le profil utilisateur
    router.put('/profile', (Request request) async {
      final userId = JwtHelper.extractUserId(request);
      if (userId == null) {
        return Response.forbidden(
            jsonEncode({'success': false, 'message': 'Non authentifié'}));
      }

      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final result = await _userService.updateProfile(userId, data);
        return Response.ok(jsonEncode(result));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Logout
    router.post('/logout', (Request request) async {
      return Response.ok(
          jsonEncode({'success': true, 'message': 'Déconnexion réussie'}));
    });

    return router;
  }
}
