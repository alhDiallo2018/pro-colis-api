// backend/lib/controllers/admin_controller.dart
import 'dart:convert';

import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

class AdminController {
  final Map<String, Map<String, dynamic>> users;
  final _uuid = const Uuid();

  AdminController({required this.users});

  Router get router {
    final router = Router();
    
    // Statistiques
    router.get('/stats/overview', _getOverviewStats);
    router.get('/stats/revenue', _getRevenueStats);
    router.get('/stats/parcels', _getParcelStats);
    
    // Gestion des utilisateurs
    router.get('/users', _getAllUsers);
    router.get('/users/<id>', _getUserById);
    router.post('/users', _createUser);
    router.put('/users/<id>', _updateUser);
    router.patch('/users/<id>/status', _updateUserStatus);
    router.patch('/users/<id>/role', _updateUserRole);
    router.delete('/users/<id>', _deleteUser);
    router.post('/users/<id>/reset-pin', _resetPin);
    
    // Gestion des garages
    router.get('/garages', _getAllGarages);
    router.get('/garages/<id>', _getGarageById);
    router.post('/garages', _createGarage);
    router.put('/garages/<id>', _updateGarage);
    router.delete('/garages/<id>', _deleteGarage);
    
    // Gestion des colis
    router.get('/parcels', _getAllParcels);
    router.get('/parcels/<id>', _getParcelById);
    router.put('/parcels/<id>/status', _updateParcelStatus);
    router.delete('/parcels/<id>', _deleteParcel);
    
    return router;
  }

  // ==================== STATISTIQUES ====================
  
  Future<Response> _getOverviewStats(Request request) async {
    try {
      // Vérifier l'authentification admin
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final totalUsers = users.length;
      final totalClients = users.values.where((u) => u['role'] == 'client').length;
      final totalDrivers = users.values.where((u) => u['role'] == 'driver').length;
      final totalAdmins = users.values.where((u) => u['role'] == 'super_admin').length;
      
      return Response.ok(jsonEncode({
        'success': true,
        'stats': {
          'totalUsers': totalUsers,
          'totalClients': totalClients,
          'totalDrivers': totalDrivers,
          'totalAdmins': totalAdmins,
          'totalGarages': 5,
          'totalParcels': 0,
          'parcelsInTransit': 0,
          'parcelsDeliveredToday': 0,
          'parcelsDeliveredThisMonth': 0,
          'totalRevenue': 0,
          'revenueThisMonth': 0,
        },
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _getRevenueStats(Request request) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      return Response.ok(jsonEncode({
        'success': true,
        'stats': {
          'daily': [12000, 15000, 18000, 22000, 25000, 28000, 30000],
          'weekly': [85000, 92000, 78000, 105000, 98000, 112000, 125000],
          'monthly': [350000, 420000, 380000, 450000, 520000],
          'total': 2450000,
        },
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _getParcelStats(Request request) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      return Response.ok(jsonEncode({
        'success': true,
        'stats': {
          'byStatus': {
            'pending': 12,
            'in_transit': 8,
            'delivered': 45,
            'cancelled': 3,
          },
          'byDay': [5, 8, 12, 7, 15, 10, 6],
          'averageDeliveryTime': 2.5,
        },
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  // ==================== GESTION DES UTILISATEURS ====================
  
  Future<Response?> _checkAdminAuth(Request request) async {
    final token = request.headers['Authorization']?.replaceFirst('Bearer ', '');
    if (token == null) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Token manquant'}));
    }
    
    final userId = token.split('_')[1];
    if (users[userId]?['role'] != 'super_admin') {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    return null;
  }

  Future<Response> _getAllUsers(Request request) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final usersList = users.values.map((user) {
        return {
          'id': user['id'],
          'email': user['email'],
          'phone': user['phone'],
          'fullName': user['fullName'],
          'role': user['role'],
          'status': user['status'] ?? 'active',
          'address': user['address'],
          'city': user['city'],
          'region': user['region'],
          'vehiclePlate': user['vehiclePlate'],
          'vehicleModel': user['vehicleModel'],
          'driverStatus': user['driverStatus'],
          'hasPin': user['pin'] != null,
          'isEmailVerified': user['isEmailVerified'] ?? false,
          'isPhoneVerified': user['isPhoneVerified'] ?? false,
          'createdAt': user['createdAt'],
          'updatedAt': user['updatedAt'],
        };
      }).toList();
      
      return Response.ok(jsonEncode({
        'success': true,
        'users': usersList,
        'total': usersList.length,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _getUserById(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      if (!users.containsKey(id)) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      return Response.ok(jsonEncode({
        'success': true,
        'user': users[id],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _createUser(Request request) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
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
      
      // Vérifier si l'email ou le téléphone existe déjà
      final existingUser = users.values.any((u) => 
        u['email'] == data['email'] || u['phone'] == data['phone']);
      
      if (existingUser) {
        return Response(409, body: jsonEncode({
          'success': false,
          'message': 'Un utilisateur avec cet email ou téléphone existe déjà',
        }));
      }
      
      final userId = _uuid.v4();
      final pin = data['pin'] ?? (100000 + DateTime.now().millisecondsSinceEpoch % 900000).toString();
      
      users[userId] = {
        'id': userId,
        'email': data['email'],
        'phone': data['phone'],
        'fullName': data['fullName'],
        'role': data['role'] ?? 'client',
        'status': data['status'] ?? 'active',
        'address': data['address'],
        'city': data['city'],
        'region': data['region'],
        'pin': pin,
        'gender': data['gender'],
        'vehiclePlate': data['vehiclePlate'],
        'vehicleModel': data['vehicleModel'],
        'driverStatus': data['driverStatus'],
        'createdAt': DateTime.now().toIso8601String(),
        'updatedAt': DateTime.now().toIso8601String(),
        'isEmailVerified': false,
        'isPhoneVerified': false,
      };
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Utilisateur créé avec succès',
        'userId': userId,
        'pin': pin,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _updateUser(Request request, String id) async {
    try {
      print('📝 Mise à jour utilisateur: $id');
      
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      if (!users.containsKey(id)) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      // Mettre à jour l'utilisateur
      users[id] = {
        ...users[id]!,
        'fullName': data['fullName'] ?? users[id]!['fullName'],
        'email': data['email'] ?? users[id]!['email'],
        'phone': data['phone'] ?? users[id]!['phone'],
        'role': data['role'] ?? users[id]!['role'],
        'status': data['status'] ?? users[id]!['status'],
        'address': data['address'] ?? users[id]!['address'],
        'city': data['city'] ?? users[id]!['city'],
        'region': data['region'] ?? users[id]!['region'],
        'vehiclePlate': data['vehiclePlate'] ?? users[id]!['vehiclePlate'],
        'vehicleModel': data['vehicleModel'] ?? users[id]!['vehicleModel'],
        'driverStatus': data['driverStatus'] ?? users[id]!['driverStatus'],
        'updatedAt': DateTime.now().toIso8601String(),
      };
      
      print('✅ Utilisateur mis à jour: ${users[id]!['fullName']}');
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Utilisateur modifié avec succès',
        'user': users[id],
      }));
    } catch (e) {
      print('❌ Erreur mise à jour: $e');
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _updateUserStatus(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      if (!users.containsKey(id)) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      users[id]!['status'] = data['status'];
      users[id]!['updatedAt'] = DateTime.now().toIso8601String();
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Statut mis à jour',
        'user': users[id],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _updateUserRole(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      if (!users.containsKey(id)) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      users[id]!['role'] = data['role'];
      users[id]!['updatedAt'] = DateTime.now().toIso8601String();
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Rôle mis à jour',
        'user': users[id],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _deleteUser(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      if (!users.containsKey(id)) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      // Empêcher la suppression de son propre compte
      final token = request.headers['Authorization']?.replaceFirst('Bearer ', '');
      final currentUserId = token?.split('_')[1];
      if (currentUserId == id) {
        return Response.forbidden(jsonEncode({
          'success': false,
          'message': 'Vous ne pouvez pas supprimer votre propre compte',
        }));
      }
      
      users.remove(id);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Utilisateur supprimé avec succès',
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _resetPin(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      if (!users.containsKey(id)) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Utilisateur non trouvé',
        }));
      }
      
      users[id]!['pin'] = '123456';
      users[id]!['updatedAt'] = DateTime.now().toIso8601String();
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'PIN réinitialisé à 123456',
        'pin': '123456',
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  // ==================== GESTION DES GARAGES ====================
  
  List<Map<String, dynamic>> _garages = [
    {
      'id': '1',
      'name': 'Garage Dakar Centre',
      'city': 'Dakar',
      'region': 'Dakar',
      'address': '123 Avenue Cheikh Anta Diop',
      'phone': '+221 33 123 45 67',
      'latitude': 14.6937,
      'longitude': -17.4441,
      'driversCount': 12,
      'parcelsCount': 234,
      'revenue': 1250000,
      'createdAt': DateTime.now().subtract(const Duration(days: 365)).toIso8601String(),
      'updatedAt': DateTime.now().toIso8601String(),
    },
    {
      'id': '2',
      'name': 'Garage Thiès',
      'city': 'Thiès',
      'region': 'Thiès',
      'address': 'Route Nationale 1',
      'phone': '+221 33 987 65 43',
      'latitude': 14.7910,
      'longitude': -16.9359,
      'driversCount': 8,
      'parcelsCount': 156,
      'revenue': 890000,
      'createdAt': DateTime.now().subtract(const Duration(days: 300)).toIso8601String(),
      'updatedAt': DateTime.now().toIso8601String(),
    },
  ];

  Future<Response> _getAllGarages(Request request) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      return Response.ok(jsonEncode({
        'success': true,
        'garages': _garages,
        'total': _garages.length,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _getGarageById(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final garage = _garages.firstWhere((g) => g['id'] == id, orElse: () => {});
      
      if (garage.isEmpty) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Garage non trouvé',
        }));
      }
      
      return Response.ok(jsonEncode({
        'success': true,
        'garage': garage,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _createGarage(Request request) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      final garageId = _uuid.v4();
      final newGarage = {
        'id': garageId,
        'name': data['name'],
        'city': data['city'],
        'region': data['region'],
        'address': data['address'],
        'phone': data['phone'],
        'latitude': data['latitude'],
        'longitude': data['longitude'],
        'driversCount': 0,
        'parcelsCount': 0,
        'revenue': 0,
        'createdAt': DateTime.now().toIso8601String(),
        'updatedAt': DateTime.now().toIso8601String(),
      };
      
      _garages.add(newGarage);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Garage créé avec succès',
        'garage': newGarage,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _updateGarage(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final index = _garages.indexWhere((g) => g['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Garage non trouvé',
        }));
      }
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      _garages[index] = {
        ..._garages[index],
        'name': data['name'] ?? _garages[index]['name'],
        'city': data['city'] ?? _garages[index]['city'],
        'region': data['region'] ?? _garages[index]['region'],
        'address': data['address'] ?? _garages[index]['address'],
        'phone': data['phone'] ?? _garages[index]['phone'],
        'latitude': data['latitude'] ?? _garages[index]['latitude'],
        'longitude': data['longitude'] ?? _garages[index]['longitude'],
        'updatedAt': DateTime.now().toIso8601String(),
      };
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Garage mis à jour',
        'garage': _garages[index],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _deleteGarage(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final index = _garages.indexWhere((g) => g['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Garage non trouvé',
        }));
      }
      
      _garages.removeAt(index);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Garage supprimé avec succès',
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  // ==================== GESTION DES COLIS (ADMIN) ====================
  
  List<Map<String, dynamic>> _parcels = [];

  Future<Response> _getAllParcels(Request request) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      return Response.ok(jsonEncode({
        'success': true,
        'parcels': _parcels,
        'total': _parcels.length,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _getParcelById(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final parcel = _parcels.firstWhere((p) => p['id'] == id, orElse: () => {});
      
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
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _updateParcelStatus(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
      final index = _parcels.indexWhere((p) => p['id'] == id);
      if (index == -1) {
        return Response.notFound(jsonEncode({
          'success': false,
          'message': 'Colis non trouvé',
        }));
      }
      
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      _parcels[index]['status'] = data['status'];
      _parcels[index]['updatedAt'] = DateTime.now().toIso8601String();
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Statut mis à jour',
        'parcel': _parcels[index],
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({
        'success': false,
        'message': 'Erreur: $e',
      }));
    }
  }

  Future<Response> _deleteParcel(Request request, String id) async {
    try {
      final authCheck = await _checkAdminAuth(request);
      if (authCheck != null) return authCheck;
      
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
        'message': 'Erreur: $e',
      }));
    }
  }
}