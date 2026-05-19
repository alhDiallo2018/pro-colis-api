import 'dart:convert';

import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

class ParcelController {
  final _uuid = const Uuid();
  final List<Map<String, dynamic>> _parcels = [];
  
  // Stockage temporaire des utilisateurs (à lier avec auth)
  final Map<String, Map<String, dynamic>> _users;

  ParcelController({required Map<String, Map<String, dynamic>> users}) : _users = users;

  Router get router {
    final router = Router();
    
    router.post('/create', _createParcel);
    router.get('/my-parcels', _getMyParcels);
    router.get('/driver/assigned', _getDriverParcels);
    router.get('/track/<tracking>', _trackParcel);
    router.get('/<id>', _getParcel);
    router.put('/<id>/status', _updateStatus);
    router.put('/<id>/assign-driver', _assignDriver);
    router.put('/<id>/cancel', _cancelParcel);
    router.get('/<id>/events', _getEvents);
    router.get('/admin/all', _getAllParcels);
    router.delete('/<id>', _deleteParcel);
    
    return router;
  }

  String _generateTrackingNumber() {
    final now = DateTime.now();
    final year = now.year;
    final month = now.month.toString().padLeft(2, '0');
    final day = now.day.toString().padLeft(2, '0');
    final random = _uuid.v4().substring(0, 6).toUpperCase();
    return 'PC-$year$month$day-$random';
  }

  String? _extractUserId(Request request) {
    final token = request.headers['Authorization']?.replaceFirst('Bearer ', '');
    if (token == null) return null;
    
    // Extraire l'userId du token (format: token_userId)
    final parts = token.split('_');
    if (parts.length < 2) return null;
    
    return parts[1];
  }

  Future<Response> _createParcel(Request request) async {
    try {
      // Extraire l'utilisateur du token
      final userId = _extractUserId(request);
      if (userId == null) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide. Veuillez vous authentifier.',
        }));
      }
      
      // Vérifier que l'utilisateur existe
      final sender = _users[userId];
      if (sender == null) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé. Veuillez vous reconnecter.',
        }));
      }
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
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
      
      final trackingNumber = _generateTrackingNumber();
      final parcelId = _uuid.v4();
      
      final parcel = {
        'id': parcelId,
        'trackingNumber': trackingNumber,
        'senderId': userId,
        'senderName': sender['fullName'] ?? 'Expéditeur',
        'senderPhone': sender['phone'] ?? '',
        'receiverName': data['receiverName'],
        'receiverPhone': data['receiverPhone'],
        'receiverEmail': data['receiverEmail'],
        'description': data['description'],
        'weight': data['weight'],
        'type': data['type'] ?? 'package',
        'status': 'pending',
        'departureGarageId': data['departureGarageId'],
        'departureGarageName': data['departureGarageName'] ?? 'Garage Départ',
        'arrivalGarageId': data['arrivalGarageId'],
        'arrivalGarageName': data['arrivalGarageName'] ?? 'Garage Arrivée',
        'driverId': null,
        'driverName': null,
        'driverPhone': null,
        'price': data['price'],
        'paymentStatus': 'pending',
        'photoUrls': data['photoUrls'] ?? [],
        'signatureUrl': null,
        'pickupDate': null,
        'deliveryDate': null,
        'createdAt': DateTime.now().toIso8601String(),
        'updatedAt': DateTime.now().toIso8601String(),
        'events': [
          {
            'id': _uuid.v4(),
            'status': 'pending',
            'description': 'Colis créé par ${sender['fullName']}',
            'location': data['departureGarageName'] ?? 'Garage Départ',
            'userId': userId,
            'userName': sender['fullName'],
            'timestamp': DateTime.now().toIso8601String(),
          }
        ],
      };
      
      _parcels.add(parcel);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Colis créé avec succès',
        'parcel': parcel,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la création: $e',
      }));
    }
  }

  Future<Response> _getMyParcels(Request request) async {
    try {
      final userId = _extractUserId(request);
      if (userId == null) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }
      
      final status = request.url.queryParameters['status'];
      var userParcels = _parcels.where((p) => p['senderId'] == userId).toList();
      
      if (status != null && status.isNotEmpty) {
        userParcels = userParcels.where((p) => p['status'] == status).toList();
      }
      
      return Response.ok(jsonEncode({
        'success': true,
        'parcels': userParcels,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  Future<Response> _getDriverParcels(Request request) async {
    try {
      final driverId = _extractUserId(request);
      if (driverId == null) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }
      
      final driverParcels = _parcels.where((p) => p['driverId'] == driverId).toList();
      
      return Response.ok(jsonEncode({
        'success': true,
        'parcels': driverParcels,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  Future<Response> _trackParcel(Request request, String tracking) async {
    try {
      final parcel = _parcels.firstWhere(
        (p) => p['trackingNumber'] == tracking,
        orElse: () => {},
      );
      
      if (parcel.isEmpty) {
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

  Future<Response> _getParcel(Request request, String id) async {
    try {
      final parcel = _parcels.firstWhere(
        (p) => p['id'] == id,
        orElse: () => {},
      );
      
      if (parcel.isEmpty) {
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

  Future<Response> _updateStatus(Request request, String id) async {
    try {
      final userId = _extractUserId(request);
      if (userId == null) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Token manquant ou invalide',
        }));
      }
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      final index = _parcels.indexWhere((p) => p['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }
      
      final oldStatus = _parcels[index]['status'];
      final newStatus = data['status'];
      final location = data['location'];
      
      // Vérifier si le changement de statut est autorisé
      if (oldStatus == 'delivered' || oldStatus == 'cancelled') {
        return Response.ok(jsonEncode({
          'success': false,
          'message': 'Impossible de modifier un colis déjà livré ou annulé',
        }));
      }
      
      _parcels[index]['status'] = newStatus;
      _parcels[index]['updatedAt'] = DateTime.now().toIso8601String();
      
      // Ajouter l'événement
      final events = _parcels[index]['events'] ?? [];
      events.add({
        'id': _uuid.v4(),
        'status': newStatus,
        'description': 'Statut mis à jour: ${_getStatusLabel(newStatus)}',
        'location': location,
        'userId': userId,
        'userName': _users[userId]?['fullName'] ?? 'Utilisateur',
        'timestamp': DateTime.now().toIso8601String(),
      });
      _parcels[index]['events'] = events;
      
      // Mettre à jour les dates spécifiques
      if (newStatus == 'picked_up') {
        _parcels[index]['pickupDate'] = DateTime.now().toIso8601String();
      } else if (newStatus == 'delivered') {
        _parcels[index]['deliveryDate'] = DateTime.now().toIso8601String();
      }
      
      return Response.ok(jsonEncode({
        'success': true,
        'parcel': _parcels[index],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la mise à jour: $e',
      }));
    }
  }

  Future<Response> _assignDriver(Request request, String id) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      final driverId = data['driverId'];
      
      final index = _parcels.indexWhere((p) => p['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }
      
      final driver = _users[driverId];
      if (driver == null) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Chauffeur non trouvé',
        }));
      }
      
      _parcels[index]['driverId'] = driverId;
      _parcels[index]['driverName'] = driver['fullName'];
      _parcels[index]['driverPhone'] = driver['phone'];
      _parcels[index]['updatedAt'] = DateTime.now().toIso8601String();
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Chauffeur assigné avec succès',
        'parcel': _parcels[index],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de l\'assignation: $e',
      }));
    }
  }

  Future<Response> _cancelParcel(Request request, String id) async {
    try {
      final index = _parcels.indexWhere((p) => p['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }
      
      final currentStatus = _parcels[index]['status'];
      // Vérifier si le colis peut être annulé
      if (currentStatus == 'delivered' || currentStatus == 'in_transit' || currentStatus == 'out_for_delivery') {
        return Response.ok(jsonEncode({
          'success': false,
          'message': 'Ce colis ne peut plus être annulé',
        }));
      }
      
      _parcels[index]['status'] = 'cancelled';
      _parcels[index]['updatedAt'] = DateTime.now().toIso8601String();
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Colis annulé avec succès',
        'parcel': _parcels[index],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de l\'annulation: $e',
      }));
    }
  }

  Future<Response> _getEvents(Request request, String id) async {
    try {
      final index = _parcels.indexWhere((p) => p['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }
      
      final events = _parcels[index]['events'] ?? [];
      
      return Response.ok(jsonEncode({
        'success': true,
        'events': events,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération des événements: $e',
      }));
    }
  }

  Future<Response> _getAllParcels(Request request) async {
    try {
      return Response.ok(jsonEncode({
        'success': true,
        'parcels': _parcels,
        'total': _parcels.length,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur lors de la récupération: $e',
      }));
    }
  }

  Future<Response> _deleteParcel(Request request, String id) async {
    try {
      final index = _parcels.indexWhere((p) => p['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }
      
      _parcels.removeAt(index);
      
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

  String _getStatusLabel(String status) {
    switch (status) {
      case 'pending': return 'En attente';
      case 'confirmed': return 'Confirmé';
      case 'picked_up': return 'Ramassé';
      case 'in_transit': return 'En transit';
      case 'arrived': return 'Arrivé';
      case 'out_for_delivery': return 'En livraison';
      case 'delivered': return 'Livré';
      case 'cancelled': return 'Annulé';
      default: return status;
    }
  }
}