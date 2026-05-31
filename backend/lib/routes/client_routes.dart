// lib/routes/client_routes.dart
import 'dart:convert';

import 'package:procolis_backend/services/email_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../services/parcel_service.dart';
import '../services/user_service.dart';
import '../utils/jwt_helper.dart';

class ClientRoutes {
  late ParcelService _parcelService;
  final UserService _userService = UserService();

  ClientRoutes({required EmailService emailService}) {
    _parcelService = ParcelService(emailService: emailService);
  }
  
  Router get router {
    final router = Router();
    
    // Middleware pour vérifier l'authentification
    Future<Response?> _authMiddleware(Request request) async {
      final userId = JwtHelper.extractUserId(request);
      if (userId == null) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
      }
      return null;
    }
    
    // ==================== PROFIL ====================
    
    router.get('/users/me', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
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
    
    router.put('/client/profile', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _userService.updateProfile(userId, data);
        return Response.ok(jsonEncode({'success': true, 'message': 'Profil mis à jour'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.put('/users/pin', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);
        await _userService.updatePin(userId, data['currentPin'], data['newPin']);
        return Response.ok(jsonEncode({'success': true, 'message': 'PIN mis à jour'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    // ==================== COLIS ====================
    
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
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.get('/parcels/my-parcels', (Request request) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      try {
        final parcels = await _parcelService.getUserParcels(userId);
        return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });
    
    router.get('/parcels/track/<trackingNumber>', (Request request, String trackingNumber) async {
      try {
        final parcel = await _parcelService.trackParcel(trackingNumber);
        if (parcel == null) {
          return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
        }
        return Response.ok(jsonEncode({'success': true, 'parcel': parcel}));
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
    
    router.put('/parcels/<parcelId>/cancel', (Request request, String parcelId) async {
      final authCheck = await _authMiddleware(request);
      if (authCheck != null) return authCheck;
      
      final userId = JwtHelper.extractUserId(request)!;
      try {
        await _parcelService.cancelParcel(parcelId, userId);
        return Response.ok(jsonEncode({'success': true, 'message': 'Colis annulé'}));
      } catch (e) {
        return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

  router.get('/parcels/<parcelId>/events', (Request request, String parcelId) async {
    final authCheck = await _authMiddleware(request);
    if (authCheck != null) return authCheck;
    
    final userId = JwtHelper.extractUserId(request)!;
    try {
      // Vérifier que l'utilisateur a accès à ce colis
      final parcel = await _parcelService.getParcelById(parcelId);
      if (parcel == null) {
        return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
      }
      
      // Vérifier que l'utilisateur est le sender, le driver, ou un admin
      if (parcel['sender_id'] != userId && 
          parcel['driver_id'] != userId && 
          !(await JwtHelper.isAdmin(userId))) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
      }
      
      final events = await _parcelService.getParcelEvents(parcelId);
      return Response.ok(jsonEncode({'success': true, 'events': events}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
});
    
    return router;
  }
}