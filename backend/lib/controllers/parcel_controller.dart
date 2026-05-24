import 'dart:convert';

import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../services/parcel_service.dart';

class ParcelController {
  final ParcelService _parcelService;

  ParcelController({required ParcelService parcelService})
      : _parcelService = parcelService;

  Router get router {
    final router = Router();

    // Routes clients
    router.post('/create', _createParcel);
    router.get('/my-parcels', _getMyParcels);
    router.get('/track/<tracking>', _trackParcel);
    router.get('/<id>', _getParcel);
    router.put('/<id>/cancel', _cancelParcel);
    router.get('/<id>/events', _getEvents);

    // Routes chauffeurs
    router.get('/driver/assigned', _getDriverParcels);
    router.put('/driver/<id>/pickup', _confirmPickup);
    router.put('/driver/<id>/deliver', _confirmDelivery);
    router.get('/driver/stats', _getDriverStats);

    // Routes garage admin
    router.get('/garage/parcels', _getGarageParcels);
    router.put('/garage/<id>/assign-driver', _assignDriverToParcel);
    router.put('/garage/<id>/status', _updateStatusByGarage);

    // Routes super admin
    router.get('/admin/all', _getAllParcels);
    router.put('/admin/<id>/update', _updateParcel);
    router.put('/admin/<id>/cancel-reason', _cancelParcelWithReason);
    router.delete('/admin/<id>', _deleteParcel);

    return router;
  }

  // ==================== METHODES UTILITAIRES ====================

  String _extractUserId(Request request) {
    final token = request.headers['Authorization']?.replaceFirst('Bearer ', '');
    if (token == null) return '';

    final parts = token.split('_');
    if (parts.length < 2) return '';

    return parts[1];
  }

  String _extractUserRole(Request request) {
    final token = request.headers['Authorization']?.replaceFirst('Bearer ', '');
    if (token == null) return '';

    final parts = token.split('_');
    if (parts.length < 3) return '';

    return parts[2];
  }

  String _extractUserName(Request request) {
    final token = request.headers['Authorization']?.replaceFirst('Bearer ', '');
    if (token == null) return '';

    final parts = token.split('_');
    if (parts.length < 4) return '';

    return Uri.decodeComponent(parts[3]);
  }

  // ==================== ROUTES CLIENTS ====================

  // Créer un colis
  Future<Response> _createParcel(Request request) async {
  try {
    final userId = _extractUserId(request);
    if (userId.isEmpty) {
      return Response.forbidden(jsonEncode({
        'success': false,
        'message': 'Token manquant ou invalide',
      }));
    }

    final body = await request.readAsString();
    final data = jsonDecode(body);
    
    // Log pour déboguer
    print('📦 Données reçues: ${jsonEncode(data)}');

    // Validation des champs requis
    final requiredFields = ['receiverName', 'receiverPhone', 'description', 'weight', 'departureGarageId'];
    for (var field in requiredFields) {
      if (data[field] == null) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'Le champ $field est requis',
        }));
      }
    }

    final result = await _parcelService.createParcel(userId, data);

    return Response.ok(jsonEncode({
      'success': true,
      'message': 'Colis créé avec succès',
      'parcel': result,
    }));
  } catch (e) {
    print('❌ Erreur création: $e');
    return Response.internalServerError(body: jsonEncode({
      'success': false,
      'message': 'Erreur lors de la création: $e',
    }));
  }
}

  // Récupérer mes colis
  Future<Response> _getMyParcels(Request request) async {
    try {
      final userId = _extractUserId(request);
      if (userId.isEmpty) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }

      final status = request.url.queryParameters['status'];
      final parcels = await _parcelService.getUserParcels(userId, status: status);

      return Response.ok(jsonEncode({
        'success': true,
        'parcels': parcels,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  // Suivre un colis
  Future<Response> _trackParcel(Request request, String tracking) async {
    try {
      final parcel = await _parcelService.getParcelByTrackingNumber(tracking);

      if (parcel == null) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }

      return Response.ok(jsonEncode({
        'success': true,
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors du suivi: $e',
      }));
    }
  }

  // Récupérer un colis par ID
  Future<Response> _getParcel(Request request, String id) async {
    try {
      final parcel = await _parcelService.getParcelById(id);

      if (parcel == null) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }

      return Response.ok(jsonEncode({
        'success': true,
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  // Annuler un colis
  Future<Response> _cancelParcel(Request request, String id) async {
    try {
      final userId = _extractUserId(request);
      final body = await request.readAsString();
      final data = body.isEmpty ? {} : jsonDecode(body);

      final parcel = await _parcelService.cancelParcel(
        id,
        userId,
        reason: data['reason'],
      );

      if (parcel == null) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Colis annulé avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de l\'annulation: $e',
      }));
    }
  }

  // Récupérer les événements d'un colis
  Future<Response> _getEvents(Request request, String id) async {
    try {
      final events = await _parcelService.getParcelEvents(id);

      return Response.ok(jsonEncode({
        'success': true,
        'events': events,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  // ==================== ROUTES CHAUFFEURS ====================

  // Récupérer les colis assignés au chauffeur
  Future<Response> _getDriverParcels(Request request) async {
    try {
      final driverId = _extractUserId(request);
      if (driverId.isEmpty) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }

      final parcels = await _parcelService.getDriverParcels(driverId);

      return Response.ok(jsonEncode({
        'success': true,
        'parcels': parcels,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  // Confirmer le ramassage
  Future<Response> _confirmPickup(Request request, String id) async {
    try {
      final driverId = _extractUserId(request);
      if (driverId.isEmpty) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }

      final parcel = await _parcelService.confirmPickup(id, driverId);

      if (parcel == null) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Ramassage confirmé avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la confirmation: $e',
      }));
    }
  }

  // Confirmer la livraison
  Future<Response> _confirmDelivery(Request request, String id) async {
    try {
      final driverId = _extractUserId(request);
      if (driverId.isEmpty) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }

      final body = await request.readAsString();
      final data = jsonDecode(body);

      final parcel = await _parcelService.confirmDelivery(id, driverId, data);

      if (parcel == null) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Livraison confirmée avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la confirmation: $e',
      }));
    }
  }

  // Statistiques du chauffeur
  Future<Response> _getDriverStats(Request request) async {
    try {
      final driverId = _extractUserId(request);
      if (driverId.isEmpty) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }

      final parcels = await _parcelService.getDriverParcels(driverId);
      
      final stats = {
        'total': parcels.length,
        'pending': parcels.where((p) => p['status'] == 'pending').length,
        'pickedUp': parcels.where((p) => p['status'] == 'picked_up').length,
        'inTransit': parcels.where((p) => p['status'] == 'in_transit').length,
        'delivered': parcels.where((p) => p['status'] == 'delivered').length,
      };

      return Response.ok(jsonEncode({
        'success': true,
        'stats': stats,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  // ==================== ROUTES GARAGE ADMIN ====================

  // Récupérer les colis du garage
  Future<Response> _getGarageParcels(Request request) async {
    try {
      final userId = _extractUserId(request);
      final userRole = _extractUserRole(request);
      
      if (userId.isEmpty || userRole != 'garage') {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Accès non autorisé',
        }));
      }

      final garageId = request.url.queryParameters['garageId'];
      if (garageId == null || garageId.isEmpty) {
        return Response.badRequest(body: jsonEncode({
          'success': false,
          'message': 'garageId requis',
        }));
      }

      final parcels = await _parcelService.getGarageParcels(garageId);

      return Response.ok(jsonEncode({
        'success': true,
        'parcels': parcels,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  // Assigner un chauffeur (garage admin)
  Future<Response> _assignDriverToParcel(Request request, String id) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);

      await _parcelService.assignDriverToParcel(id, data['driverId']);

      final parcel = await _parcelService.getParcelById(id);

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Chauffeur assigné avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de l\'assignation: $e',
      }));
    }
  }

  // Mettre à jour le statut (garage admin)
  Future<Response> _updateStatusByGarage(Request request, String id) async {
    try {
      final userId = _extractUserId(request);
      final userName = _extractUserName(request);
      final body = await request.readAsString();
      final data = jsonDecode(body);

      final parcel = await _parcelService.updateParcelStatus(
        id,
        data['status'],
        userId: userId,
        userName: userName,
        location: data['location'],
        description: data['description'],
      );

      if (parcel == null) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Statut mis à jour avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la mise à jour: $e',
      }));
    }
  }

  // ==================== ROUTES SUPER ADMIN ====================

  // Récupérer tous les colis
  Future<Response> _getAllParcels(Request request) async {
    try {
      final parcels = await _parcelService.getAllParcels();

      return Response.ok(jsonEncode({
        'success': true,
        'parcels': parcels,
        'total': parcels.length,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  // Mettre à jour un colis (admin)
  Future<Response> _updateParcel(Request request, String id) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);

      await _parcelService.updateParcel(id, data);

      final parcel = await _parcelService.getParcelById(id);

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Colis mis à jour avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la mise à jour: $e',
      }));
    }
  }

  // Annuler un colis avec raison (admin)
  Future<Response> _cancelParcelWithReason(Request request, String id) async {
    try {
      final userId = _extractUserId(request);
      final body = await request.readAsString();
      final data = jsonDecode(body);

      await _parcelService.cancelParcelWithReason(id, userId, data['reason']);

      final parcel = await _parcelService.getParcelById(id);

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Colis annulé avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de l\'annulation: $e',
      }));
    }
  }

  // Supprimer un colis (admin)
  Future<Response> _deleteParcel(Request request, String id) async {
    try {
      final success = await _parcelService.deleteParcel(id);

      if (!success) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }

      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Colis supprimé avec succès',
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la suppression: $e',
      }));
    }
  }
}