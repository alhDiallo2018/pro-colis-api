// lib/routes/garage_admin_routes.dart
import 'dart:convert';

import 'package:procolis_backend/services/database_service.dart';
import 'package:procolis_backend/services/email_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../services/garage_service.dart';
import '../services/parcel_service.dart';
import '../utils/jwt_helper.dart';


class GarageAdminRoutes {
  late ParcelService _parcelService;
  final GarageService _garageService = GarageService();

  GarageAdminRoutes({required EmailService emailService}) {
    _parcelService = ParcelService(emailService: emailService);
  }
  
  Router get router {
    final router = Router();
    
    // Middleware pour vérifier l'authentification et le rôle admin
    Future<Response?> _authMiddleware(Request request) async {
      final userId = JwtHelper.extractUserId(request);
      if (userId == null) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
      }
      final isAdmin = await JwtHelper.isAdmin(userId);
      if (!isAdmin) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès réservé aux administrateurs de garage'}));
      }
      return null;
    }
    
    // ==================== ROUTES PROFIL ====================
    
    // Mettre à jour le profil de l'admin garage
    router.put('/profile', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      print('🔐 Admin userId: $userId');
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        
        print('📝 Mise à jour profil admin: $userId');
        print('📝 Données reçues: $data');
        
        final db = await DatabaseService.getInstance();
        
        // Construction dynamique de la requête UPDATE
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
        
        if (updates.isEmpty) {
          return Response.ok(jsonEncode({
            'success': true,
            'message': 'Aucune modification apportée'
          }));
        }
        
        updates.add('updated_at = NOW()');
        
        final query = '''
          UPDATE users 
          SET ${updates.join(', ')}
          WHERE id = \$1
        ''';
        
        await db.connection.execute(query, parameters: params);
        
        print('✅ Profil admin mis à jour avec succès');
        
        // Récupérer l'utilisateur mis à jour
        final updatedUserResult = await db.connection.execute('''
          SELECT id, email, phone, full_name, role, status, address, city, region, 
                 vehicle_plate, vehicle_model, driver_status, garage_id, profile_photo,
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
            'driverStatus': row[11],
            'garageId': row[12],
            'profilePhotoUrl': row[13],
            'createdAt': (row[14] as DateTime).toIso8601String(),
            'updatedAt': (row[15] as DateTime).toIso8601String(),
          };
          
          return Response.ok(jsonEncode({
            'success': true,
            'message': 'Profil mis à jour avec succès',
            'user': user
          }));
        }
        
        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Profil mis à jour avec succès'
        }));
      } catch (e) {
        print('❌ Erreur update profile: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.put('/profile-photo', (Request request) async {
  final authCheck = await _authMiddleware(request);
  if (authCheck != null) return authCheck;
  
  final userId = JwtHelper.extractUserId(request)!;
  
  try {
    final body = await request.readAsString();
    final data = jsonDecode(body);
    final photoUrl = data['photoUrl'];
    
    if (photoUrl == null || photoUrl.isEmpty) {
      return Response.badRequest(body: jsonEncode({
        'success': false,
        'message': 'URL de photo invalide'
      }));
    }
    
    final db = await DatabaseService.getInstance();
    final result = await db.connection.execute('''
      UPDATE users 
      SET profile_photo = \$2, updated_at = NOW()
      WHERE id = \$1
      RETURNING id, profile_photo
    ''', parameters: [userId, photoUrl]);
    
    if (result.isEmpty) {
      return Response.notFound(jsonEncode({
        'success': false,
        'message': 'Utilisateur non trouvé'
      }));
    }
    
    print('✅ Photo de profil mise à jour: $userId -> $photoUrl');
    
    return Response.ok(jsonEncode({
      'success': true,
      'message': 'Photo de profil mise à jour avec succès',
      'profilePhoto': photoUrl
    }));
  } catch (e) {
    print('❌ Erreur update profile photo: $e');
    return Response.internalServerError(body: jsonEncode({
      'success': false,
      'message': e.toString()
    }));
  }
});
    // Récupérer le profil de l'admin garage
    router.get('/profile', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      
      try {
        final db = await DatabaseService.getInstance();
        final result = await db.connection.execute('''
          SELECT id, email, phone, full_name, role, status, address, city, region, 
                 vehicle_plate, vehicle_model, driver_status, garage_id, profile_photo,
                 created_at, updated_at
          FROM users WHERE id = \$1
        ''', parameters: [userId]);
        
        if (result.isEmpty) {
          return Response.notFound(jsonEncode({'success': false, 'message': 'Utilisateur non trouvé'}));
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
          'driverStatus': row[11],
          'garageId': row[12],
          'profilePhotoUrl': row[13],
          'createdAt': (row[14] as DateTime).toIso8601String(),
          'updatedAt': (row[15] as DateTime).toIso8601String(),
        };
        
        return Response.ok(jsonEncode({
          'success': true,
          'user': user
        }));
      } catch (e) {
        print('❌ Erreur get profile: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
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
          return Response.badRequest(body: jsonEncode({
            'success': false,
            'message': 'URL de photo invalide'
          }));
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
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // ==================== ROUTES COLIS ====================
    
    // Récupérer les colis du garage
    router.get('/parcels', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      if (userId.isEmpty) {
        return Response.notFound(
          jsonEncode({
            'success': false,
            'message': 'Token invalide',
          }),
        );
      }
      try {
        final garageId = await _garageService.getGarageIdByAdmin(userId);
        if (garageId == null) {
          return Response.notFound(
            jsonEncode({
              'success': false,
              'message': 'Aucun garage associé à cet administrateur',
            }),
          );
        }
        final parcels = await _parcelService.getGarageParcels(garageId);
        return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
      } catch (e) {
        print('❌ Erreur get parcels: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // Mettre à jour le statut d'un colis
    router.put('/parcels/<parcelId>/status', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      print('🔐 Admin userId: $userId');
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final newStatus = data['status'];
        final location = data['location'];
        
        print('📦 Mise à jour colis: $parcelId');
        print('📦 Nouveau statut: $newStatus');
        print('📦 Location: $location');
        
        // Récupérer le garage de l'admin
        final garageId = await _garageService.getGarageIdByAdmin(userId);
        print('🏢 Garage admin: $garageId');
        
        if (garageId == null) {
          print('❌ Aucun garage trouvé pour l\'admin');
          return Response.notFound(
            jsonEncode({
              'success': false,
              'message': 'Aucun garage associé à cet administrateur',
            }),
          );
        }
        
        // Récupérer les informations du colis
        final db = await DatabaseService.getInstance();
        final parcelResult = await db.connection.execute('''
          SELECT departure_garage_id, arrival_garage_id, status 
          FROM parcels WHERE id = \$1
        ''', parameters: [parcelId]);
        
        if (parcelResult.isEmpty) {
          print('❌ Colis non trouvé: $parcelId');
          return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
        }
        
        final departureGarageId = parcelResult.first[0];
        final arrivalGarageId = parcelResult.first[1];
        final currentStatus = parcelResult.first[2];
        
        print('🏢 Departure garage: $departureGarageId');
        print('🏢 Arrival garage: $arrivalGarageId');
        print('📦 Statut actuel: $currentStatus');
        
        // Vérifier que le colis appartient au garage (départ OU arrivée)
        final belongsToGarage = (departureGarageId == garageId || arrivalGarageId == garageId);
        
        if (!belongsToGarage) {
          print('❌ Accès refusé: colis n\'appartient pas au garage');
          return Response.forbidden(jsonEncode({
            'success': false, 
            'message': 'Ce colis n\'appartient pas à votre garage'
          }));
        }
        
        // Mettre à jour le statut
        await db.connection.execute('''
          UPDATE parcels 
          SET status = \$2, updated_at = NOW() 
          WHERE id = \$1
        ''', parameters: [parcelId, newStatus]);
        
        print('✅ Statut mis à jour avec succès');
        
        // Récupérer le colis mis à jour
        final updatedParcel = await _parcelService.getParcelById(parcelId);
        
        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Statut mis à jour avec succès',
          'parcel': updatedParcel
        }));
      } catch (e) {
        print('❌ Erreur update status: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // Annuler un colis
    router.put('/parcels/<parcelId>/cancel', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      print('🔐 Admin userId: $userId');
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final reason = data['reason'] ?? data['status'] == 'cancelled' ? 'Annulation par l\'administrateur' : null;
        
        print('📦 Annulation colis: $parcelId');
        print('📦 Raison: $reason');
        
        // Récupérer le garage de l'admin
        final garageId = await _garageService.getGarageIdByAdmin(userId);
        
        if (garageId == null) {
          print('❌ Aucun garage trouvé pour l\'admin');
          return Response.notFound(
            jsonEncode({
              'success': false,
              'message': 'Aucun garage associé à cet administrateur',
            }),
          );
        }
        
        // Récupérer les informations du colis
        final db = await DatabaseService.getInstance();
        final parcelResult = await db.connection.execute('''
          SELECT departure_garage_id, arrival_garage_id, status 
          FROM parcels WHERE id = \$1
        ''', parameters: [parcelId]);
        
        if (parcelResult.isEmpty) {
          print('❌ Colis non trouvé: $parcelId');
          return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
        }
        
        final departureGarageId = parcelResult.first[0];
        final arrivalGarageId = parcelResult.first[1];
        
        // Vérifier que le colis appartient au garage
        final belongsToGarage = (departureGarageId == garageId || arrivalGarageId == garageId);
        
        if (!belongsToGarage) {
          print('❌ Accès refusé: colis n\'appartient pas au garage');
          return Response.forbidden(jsonEncode({
            'success': false, 
            'message': 'Ce colis n\'appartient pas à votre garage'
          }));
        }
        
        // Annuler le colis
        await _parcelService.cancelParcel(parcelId, userId);
        
        print('✅ Colis annulé avec succès');
        
        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Colis annulé avec succès'
        }));
      } catch (e) {
        print('❌ Erreur cancel parcel: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // Assigner un chauffeur à un colis
    router.put('/parcels/<parcelId>/assign-driver', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final driverId = data['driverId'];
        
        print('🚚 Assignation chauffeur $driverId au colis $parcelId');
        
        await _parcelService.assignDriverToParcel(parcelId, driverId);
        
        return Response.ok(jsonEncode({
          'success': true, 
          'message': 'Chauffeur assigné avec succès'
        }));
      } catch (e) {
        print('❌ Erreur assign driver: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // Supprimer un colis
    router.delete('/parcels/<parcelId>', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      print('🔐 Admin userId: $userId');
      
      try {
        // Récupérer le garage de l'admin
        final garageId = await _garageService.getGarageIdByAdmin(userId);
        
        if (garageId == null) {
          print('❌ Aucun garage trouvé pour l\'admin');
          return Response.notFound(
            jsonEncode({
              'success': false,
              'message': 'Aucun garage associé à cet administrateur',
            }),
          );
        }
        
        // Récupérer les informations du colis
        final db = await DatabaseService.getInstance();
        final parcelResult = await db.connection.execute('''
          SELECT departure_garage_id, arrival_garage_id, status 
          FROM parcels WHERE id = \$1
        ''', parameters: [parcelId]);
        
        if (parcelResult.isEmpty) {
          print('❌ Colis non trouvé: $parcelId');
          return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
        }
        
        final departureGarageId = parcelResult.first[0];
        final arrivalGarageId = parcelResult.first[1];
        
        // Vérifier que le colis appartient au garage
        final belongsToGarage = (departureGarageId == garageId || arrivalGarageId == garageId);
        
        if (!belongsToGarage) {
          print('❌ Accès refusé: colis n\'appartient pas au garage');
          return Response.forbidden(jsonEncode({
            'success': false, 
            'message': 'Ce colis n\'appartient pas à votre garage'
          }));
        }
        
        // Supprimer le colis
        await _parcelService.deleteParcel(parcelId);
        
        print('✅ Colis supprimé avec succès: $parcelId');
        
        return Response.ok(jsonEncode({
          'success': true,
          'message': 'Colis supprimé avec succès'
        }));
      } catch (e) {
        print('❌ Erreur delete parcel: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // ==================== ROUTES CHAUFFEURS ====================
    
    // Récupérer les chauffeurs du garage
    router.get('/drivers', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      try {
        final garageId = await _garageService.getGarageIdByAdmin(userId);
        if (garageId == null) {
          return Response.notFound(
            jsonEncode({
              'success': false,
              'message': 'Aucun garage associé à cet administrateur',
            }),
          );
        }
        final drivers = await _garageService.getGarageDrivers(garageId);
        return Response.ok(jsonEncode({'success': true, 'drivers': drivers}));
      } catch (e) {
        print('❌ Erreur get drivers: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // ==================== ROUTES STATISTIQUES ====================
    
    // Statistiques du garage
    router.get('/stats', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      try {
        final garageId = await _garageService.getGarageIdByAdmin(userId);
        if (garageId == null) {
          return Response.notFound(
            jsonEncode({
              'success': false,
              'message': 'Aucun garage associé à cet administrateur',
            }),
          );
        }
        final stats = await _garageService.getGarageStats(garageId);
        return Response.ok(jsonEncode({'success': true, 'stats': stats}));
      } catch (e) {
        print('❌ Erreur get stats: $e');
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    return router;
  }
}