// lib/routes/super_admin_routes.dart
import 'dart:convert';

import 'package:procolis_backend/services/email_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../services/garage_service.dart';
import '../services/parcel_service.dart';
import '../services/stats_service.dart';
import '../services/user_service.dart';
import '../utils/jwt_helper.dart';

class SuperAdminRoutes {
  final UserService _userService = UserService();
  final GarageService _garageService = GarageService();
  late ParcelService _parcelService;
  final StatsService _statsService = StatsService();

  SuperAdminRoutes({required EmailService emailService}) {
    _parcelService = ParcelService(emailService: emailService);
  }
  
  Router get router {
    final router = Router();
    
    // Middleware pour vérifier l'authentification et le rôle super admin
    Future<Response?> _authMiddleware(Request request) async {
      final userId = JwtHelper.extractUserId(request);
      if (userId == null) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
      }
      final isSuperAdmin = await JwtHelper.isSuperAdmin(userId);
      if (!isSuperAdmin) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès réservé au super administrateur'}));
      }
      return null;
    }
    
    // ==================== STATISTIQUES ====================
    
    router.get('/stats', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final stats = await _statsService.getGlobalStats();
        return Response.ok(jsonEncode({'success': true, 'stats': stats}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.get('/stats/advanced', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final stats = await _statsService.getAdvancedStats();
        return Response.ok(jsonEncode({'success': true, 'stats': stats}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // ==================== GESTION DES UTILISATEURS ====================
    
    router.get('/users', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final users = await _userService.getAllUsers();
        return Response.ok(jsonEncode({'success': true, 'users': users}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.get('/users/<userId>', (Request request, String userId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final user = await _userService.getUserById(userId);
        if (user == null) {
          return Response.notFound(jsonEncode({'success': false, 'message': 'Utilisateur non trouvé'}));
        }
        return Response.ok(jsonEncode({'success': true, 'user': user}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.post('/users', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final userId = await _userService.createUser(data);
        return Response.ok(jsonEncode({'success': true, 'message': 'Utilisateur créé', 'userId': userId}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.put('/users/<userId>', (Request request, String userId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _userService.updateUser(userId, data);
        return Response.ok(jsonEncode({'success': true, 'message': 'Utilisateur mis à jour'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.patch('/users/<userId>/role', (Request request, String userId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _userService.updateUserRole(userId, data['role']);
        return Response.ok(jsonEncode({'success': true, 'message': 'Rôle mis à jour'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.patch('/users/<userId>/status', (Request request, String userId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _userService.updateUserStatus(userId, data['status']);
        return Response.ok(jsonEncode({'success': true, 'message': 'Statut mis à jour'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.delete('/users/<userId>', (Request request, String userId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        await _userService.deleteUser(userId);
        return Response.ok(jsonEncode({'success': true, 'message': 'Utilisateur supprimé'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // ==================== GESTION DES GARAGES ====================
    
    router.get('/garages', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final garages = await _garageService.getAllGarages();
        return Response.ok(jsonEncode({'success': true, 'garages': garages}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.get('/garages/<garageId>', (Request request, String garageId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final garage = await _garageService.getGarageById(garageId);
        if (garage == null) {
          return Response.notFound(jsonEncode({'success': false, 'message': 'Garage non trouvé'}));
        }
        return Response.ok(jsonEncode({'success': true, 'garage': garage}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.post('/garages', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        final garageId = await _garageService.createGarage(data);
        return Response.ok(jsonEncode({'success': true, 'message': 'Garage créé', 'garageId': garageId}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.put('/garages/<garageId>', (Request request, String garageId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _garageService.updateGarage(garageId, data);
        return Response.ok(jsonEncode({'success': true, 'message': 'Garage mis à jour'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.delete('/garages/<garageId>', (Request request, String garageId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        await _garageService.deleteGarage(garageId);
        return Response.ok(jsonEncode({'success': true, 'message': 'Garage supprimé'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // ==================== GESTION DES COLIS ====================
    
    router.get('/parcels', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final parcels = await _parcelService.getAllParcels();
        return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.get('/parcels/<parcelId>', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final parcel = await _parcelService.getParcelById(parcelId);
        if (parcel == null) {
          return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
        }
        return Response.ok(jsonEncode({'success': true, 'parcel': parcel}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.put('/parcels/<parcelId>', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _parcelService.updateParcelInfo(parcelId, data);
        return Response.ok(jsonEncode({'success': true, 'message': 'Colis mis à jour'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.delete('/parcels/<parcelId>', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      try {
        await _parcelService.deleteParcel(parcelId);
        return Response.ok(jsonEncode({'success': true, 'message': 'Colis supprimé'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    return router;
  }
}