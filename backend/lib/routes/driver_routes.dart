// lib/routes/driver_routes.dart
import 'dart:convert';

import 'package:procolis_backend/services/database_service.dart';
import 'package:procolis_backend/services/email_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../services/driver_service.dart';
import '../services/parcel_service.dart';
import '../utils/jwt_helper.dart';

class DriverRoutes {
  late final ParcelService _parcelService;
  final DriverService _driverService = DriverService();

  DriverRoutes({required EmailService emailService}) {
    _parcelService = ParcelService(emailService: emailService);
  }

  Router get router {
    final router = Router();

    // Middleware pour vérifier l'authentification et le rôle chauffeur
    Future<Response?> _authMiddleware(Request request) async {
      final userId = JwtHelper.extractUserId(request);
      print('🔐 Auth middleware - userId extrait: $userId');

      if (userId == null) {
        return Response.forbidden(
            jsonEncode({'success': false, 'message': 'Non authentifié'}));
      }

      final isDriver = await JwtHelper.isDriver(userId);
      print('🔐 isDriver: $isDriver');

      if (!isDriver) {
        return Response.forbidden(jsonEncode(
            {'success': false, 'message': 'Accès réservé aux chauffeurs'}));
      }

      print('✅ Auth OK pour driver: $userId');
      return null;
    }

    // ==================== ROUTES PROFIL ====================

    // Récupérer le profil du chauffeur
    router.get('/profile', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;

      try {
        final db = await DatabaseService.getInstance();
        final result = await db.connection.execute('''
          SELECT id, email, phone, full_name, role, status, address, city, region, 
                 vehicle_plate, vehicle_model, vehicle_color, vehicle_year,
                 driver_status, garage_id, profile_photo,
                 created_at, updated_at
          FROM users WHERE id = \$1
        ''', parameters: [userId]);

        if (result.isEmpty) {
          return Response.notFound(jsonEncode(
              {'success': false, 'message': 'Utilisateur non trouvé'}));
        }

        final row = result.first;
        final user = {
          'id': row[0],
          'email': row[1],
          'phone': row[2],
          'fullName': row[3],
          'role': row[4],
          'status': row[5],
          'address': row[6],
          'city': row[7],
          'region': row[8],
          'vehiclePlate': row[9],
          'vehicleModel': row[10],
          'vehicleColor': row[11],
          'vehicleYear': row[12],
          'driverStatus': row[13],
          'garageId': row[14],
          'profilePhotoUrl': row[15],
          'createdAt': (row[16] as DateTime).toIso8601String(),
          'updatedAt': (row[17] as DateTime).toIso8601String(),
        };

        return Response.ok(jsonEncode({'success': true, 'user': user}));
      } catch (e) {
        print('❌ Erreur get profile: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Mettre à jour le profil du chauffeur
    router.put('/profile', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;
      print('🔐 Driver userId: $userId');

      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        print('📝 Mise à jour profil chauffeur: $userId');
        print('📝 Données reçues: $data');

        final db = await DatabaseService.getInstance();

        final updates = <String>[];
        final params = <dynamic>[userId];
        int paramIndex = 2;

        if (data.containsKey('fullName') && data['fullName'] != null) {
          updates.add('full_name = \$$paramIndex');
          params.add(data['fullName']);
          paramIndex++;
        }
        if (data.containsKey('email') && data['email'] != null) {
          updates.add('email = \$$paramIndex');
          params.add(data['email']);
          paramIndex++;
        }
        if (data.containsKey('phone') && data['phone'] != null) {
          updates.add('phone = \$$paramIndex');
          params.add(data['phone']);
          paramIndex++;
        }
        if (data.containsKey('address') && data['address'] != null) {
          updates.add('address = \$$paramIndex');
          params.add(data['address']);
          paramIndex++;
        }
        if (data.containsKey('city') && data['city'] != null) {
          updates.add('city = \$$paramIndex');
          params.add(data['city']);
          paramIndex++;
        }
        if (data.containsKey('region') && data['region'] != null) {
          updates.add('region = \$$paramIndex');
          params.add(data['region']);
          paramIndex++;
        }
        if (data.containsKey('vehiclePlate') && data['vehiclePlate'] != null) {
          updates.add('vehicle_plate = \$$paramIndex');
          params.add(data['vehiclePlate']);
          paramIndex++;
        }
        if (data.containsKey('vehicleModel') && data['vehicleModel'] != null) {
          updates.add('vehicle_model = \$$paramIndex');
          params.add(data['vehicleModel']);
          paramIndex++;
        }
        if (data.containsKey('vehicleColor') && data['vehicleColor'] != null) {
          updates.add('vehicle_color = \$$paramIndex');
          params.add(data['vehicleColor']);
          paramIndex++;
        }
        if (data.containsKey('vehicleYear') && data['vehicleYear'] != null) {
          updates.add('vehicle_year = \$$paramIndex');
          params.add(data['vehicleYear']);
          paramIndex++;
        }

        if (updates.isEmpty) {
          return Response.ok(jsonEncode(
              {'success': true, 'message': 'Aucune modification apportée'}));
        }

        updates.add('updated_at = NOW()');

        final query = '''
          UPDATE users 
          SET ${updates.join(', ')}
          WHERE id = \$1
        ''';

        await db.connection.execute(query, parameters: params);

        print('✅ Profil chauffeur mis à jour avec succès');

        final updatedUserResult = await db.connection.execute('''
          SELECT id, email, phone, full_name, role, status, address, city, region, 
                 vehicle_plate, vehicle_model, vehicle_color, vehicle_year,
                 driver_status, garage_id, profile_photo,
                 created_at, updated_at
          FROM users WHERE id = \$1
        ''', parameters: [userId]);

        if (updatedUserResult.isNotEmpty) {
          final row = updatedUserResult.first;
          final user = {
            'id': row[0],
            'email': row[1],
            'phone': row[2],
            'fullName': row[3],
            'role': row[4],
            'status': row[5],
            'address': row[6],
            'city': row[7],
            'region': row[8],
            'vehiclePlate': row[9],
            'vehicleModel': row[10],
            'vehicleColor': row[11],
            'vehicleYear': row[12],
            'driverStatus': row[13],
            'garageId': row[14],
            'profilePhotoUrl': row[15],
            'createdAt': (row[16] as DateTime).toIso8601String(),
            'updatedAt': (row[17] as DateTime).toIso8601String(),
          };

          return Response.ok(jsonEncode({
            'success': true,
            'message': 'Profil mis à jour avec succès',
            'user': user
          }));
        }

        return Response.ok(jsonEncode(
            {'success': true, 'message': 'Profil mis à jour avec succès'}));
      } catch (e) {
        print('❌ Erreur update profile: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Mettre à jour la photo de profil
    router.put('/profile-photo', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;

      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final photoUrl = data['photoUrl'];

        if (photoUrl == null || photoUrl.isEmpty) {
          return Response.badRequest(
              body: jsonEncode(
                  {'success': false, 'message': 'URL de photo invalide'}));
        }

        final db = await DatabaseService.getInstance();
        await db.connection.execute('''
          UPDATE users 
          SET profile_photo = \$2, updated_at = NOW()
          WHERE id = \$1
        ''', parameters: [userId, photoUrl]);

        print('✅ Photo de profil mise à jour: $userId');

        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Photo de profil mise à jour avec succès'
        }));
      } catch (e) {
        print('❌ Erreur update profile photo: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Mettre à jour le statut du chauffeur
    router.put('/status', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _driverService.updateDriverStatus(userId, data['status']);
        return Response.ok(
            jsonEncode({'success': true, 'message': 'Statut mis à jour'}));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // ==================== ROUTES COLIS ====================

    // Créer un colis
    router.post('/parcels/create', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final result = await _parcelService.createParcel(userId, data);
        return Response.ok(jsonEncode(result));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Récupérer les colis du chauffeur (liste)
    router.get('/parcels', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;
      try {
        final parcels = await _parcelService.getDriverParcels(userId);
        return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Récupérer un colis spécifique
    router.get('/parcels/<parcelId>', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;
      print('🔑 Driver ID: $userId');
      print('🔍 Parcel ID demandé: $parcelId');

      try {
        final parcel = await _parcelService.getParcelById(parcelId);

        print('📦 Parcel trouvé: ${parcel != null}');
        if (parcel != null) {
          print('📦 Driver ID dans colis: ${parcel['driverId']}');
        }

        if (parcel == null) {
          return Response.notFound(
              jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
        }

        if (parcel['driverId'] != userId) {
          return Response.forbidden(jsonEncode({
            'success': false,
            'message': 'Vous n\'êtes pas autorisé à voir ce colis'
          }));
        }

        return Response.ok(jsonEncode({'success': true, 'parcel': parcel}));
      } catch (e) {
        print('❌ Erreur getParcelById: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Confirmer ramassage
    router.put('/parcels/<parcelId>/pickup',
        (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;
      try {
        final result = await _parcelService.confirmPickup(parcelId, userId);
        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Ramassage confirmé',
          'parcel': result
        }));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Confirmer livraison
    router.put('/parcels/<parcelId>/deliver',
        (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request)!;
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final result = await _parcelService.confirmDelivery(parcelId, userId, data);
        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Livraison confirmée',
          'parcel': result
        }));
      } catch (e) {
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // Mettre à jour le statut d'un colis
    router.put('/parcels/<parcelId>/status',
        (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;

      final userId = JwtHelper.extractUserId(request);
      if (userId == null) {
        return Response.forbidden(
            jsonEncode({'success': false, 'message': 'Non authentifié'}));
      }

      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final newStatus = data['status'];
        final location = data['location'];

        print('🔑 userId extrait: $userId');
        print('📝 Chauffeur $userId change statut $parcelId -> $newStatus');

        final updatedParcel = await _parcelService.updateParcelStatus(
          parcelId,
          newStatus,
          userId: userId,
          location: location,
        );

        if (updatedParcel == null) {
          return Response.notFound(
              jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
        }

        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Statut mis à jour avec succès',
          'parcel': updatedParcel
        }));
      } catch (e) {
        print('❌ Erreur update status: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    return router;
  }
}