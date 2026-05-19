import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/garage.dart';
import '../models/parcel.dart';
import '../models/user.dart';

class ApiService {
  static const String baseUrl = 'http://localhost:8080';
  final Dio _dio = Dio();
  final _storage = const FlutterSecureStorage();

  ApiService() {
    _dio.options.baseUrl = baseUrl;
    _dio.options.headers['Content-Type'] = 'application/json';
    _dio.options.connectTimeout = const Duration(seconds: 30);
    _dio.options.receiveTimeout = const Duration(seconds: 30);
    
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.read(key: 'token');
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
          debugPrint('🔐 Token ajouté à la requête: ${options.path}');
        } else {
          debugPrint('⚠️ Aucun token trouvé pour: ${options.path}');
        }
        return handler.next(options);
      },
      onResponse: (response, handler) {
        debugPrint('✅ Réponse reçue: ${response.statusCode} - ${response.requestOptions.path}');
        return handler.next(response);
      },
      onError: (error, handler) async {
        debugPrint('❌ Erreur API: ${error.response?.statusCode} - ${error.requestOptions.path}');
        if (error.response?.statusCode == 401) {
          debugPrint('🔐 Token expiré, déconnexion...');
          await clearToken();
        }
        return handler.next(error);
      },
    ));
  }

  Future<String?> getToken() async => await _storage.read(key: 'token');
  
  Future<void> setToken(String token) async {
    debugPrint('🔐 Token stocké: ${token.substring(0, token.length > 20 ? 20 : token.length)}...');
    await _storage.write(key: 'token', value: token);
  }
  
  Future<void> clearToken() async {
    debugPrint('🔐 Token effacé');
    await _storage.delete(key: 'token');
  }

  Map<String, dynamic> _handleResponse(Response response) {
    if (response.data is String) {
      return jsonDecode(response.data as String);
    }
    return response.data as Map<String, dynamic>;
  }

  // ==================== MÉTHODES D'AUTHENTIFICATION ====================
  
  Future<Map<String, dynamic>> register({
    required String email,
    required String phone,
    required String fullName,
    required String password,
    String role = 'client',
    String? address,
    String? city,
    String? region,
    String? vehiclePlate,
    String? vehicleModel,
    String? garageId,
  }) async {
    try {
      final response = await _dio.post('/auth/register', data: {
        'email': email,
        'phone': phone,
        'fullName': fullName,
        'password': password,
        'role': role,
        'address': address,
        'city': city,
        'region': region,
        'vehiclePlate': vehiclePlate,
        'vehicleModel': vehicleModel,
        'garageId': garageId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> sendOtp(String identifier) async {
    try {
      final response = await _dio.post('/auth/send-otp', data: {'identifier': identifier});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> verifyOtp(String userId, String code, String type) async {
    try {
      final response = await _dio.post('/auth/verify-otp', data: {
        'userId': userId,
        'code': code,
        'type': type,
      });
      
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['accessToken'] != null) {
        await setToken(responseData['accessToken']);
      }
      return responseData;
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<void> logout() async {
    await clearToken();
  }

  Future<Map<String, dynamic>> loginWithPin(String pin) async {
    try {
      final response = await _dio.post('/auth/login-with-pin', data: {'pin': pin});
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['accessToken'] != null) {
        await setToken(responseData['accessToken']);
      }
      return responseData;
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES UTILISATEUR ====================
  
  Future<User> getCurrentUser() async {
    try {
      final response = await _dio.get('/users/me');
      final responseData = _handleResponse(response);
      if (responseData['success'] == true && responseData['user'] != null) {
        return User.fromJson(responseData['user']);
      }
      throw Exception('Utilisateur non trouvé');
    } catch (e) {
      debugPrint('❌ Erreur getCurrentUser: $e');
      rethrow;
    }
  }

  Future<Map<String, dynamic>> updateProfile({
    required String fullName,
    required String email,
    required String phone,
    String? address,
    String? city,
    String? region,
    String? vehiclePlate,
    String? vehicleModel,
  }) async {
    try {
      final response = await _dio.put('/users/profile', data: {
        'fullName': fullName,
        'email': email,
        'phone': phone,
        'address': address,
        'city': city,
        'region': region,
        'vehiclePlate': vehiclePlate,
        'vehicleModel': vehicleModel,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updatePin(String currentPin, String newPin) async {
    try {
      final response = await _dio.put('/users/pin', data: {
        'currentPin': currentPin,
        'newPin': newPin,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES PARCELS ====================
  
  Future<List<Parcel>> getMyParcels({String? status}) async {
    try {
      final queryParams = status != null ? {'status': status} : <String, dynamic>{};
      final response = await _dio.get('/parcels/my-parcels', queryParameters: queryParams);
      final responseData = _handleResponse(response);
      
      final List<dynamic> parcelsData = responseData['parcels'] ?? [];
      return parcelsData.map((json) => Parcel.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getMyParcels: $e');
      return [];
    }
  }

  Future<List<Parcel>> getDriverParcels() async {
    try {
      final response = await _dio.get('/driver/parcels');
      final responseData = _handleResponse(response);
      
      final List<dynamic> parcelsData = responseData['parcels'] ?? [];
      return parcelsData.map((json) => Parcel.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getDriverParcels: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> confirmPickup(String parcelId) async {
    try {
      final response = await _dio.put('/driver/parcels/$parcelId/pickup');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> confirmDelivery(String parcelId, {String? signature, String? photoUrl}) async {
    try {
      final response = await _dio.put('/driver/parcels/$parcelId/deliver', data: {
        'signature': signature,
        'photoUrl': photoUrl,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Parcel> createParcel(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/parcels/create', data: data);
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['parcel'] != null) {
        return Parcel.fromMinimalJson(responseData['parcel'] as Map<String, dynamic>);
      } else {
        throw Exception(responseData['message'] ?? 'Erreur lors de la création');
      }
    } catch (e) {
      debugPrint('❌ Erreur createParcel: $e');
      rethrow;
    }
  }

  Future<Parcel> trackParcel(String trackingNumber) async {
    try {
      final response = await _dio.get('/parcels/track/$trackingNumber');
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['parcel'] != null) {
        return Parcel.fromJson(responseData['parcel'] as Map<String, dynamic>);
      } else {
        throw Exception(responseData['message'] ?? 'Colis non trouvé');
      }
    } catch (e) {
      debugPrint('❌ Erreur trackParcel: $e');
      rethrow;
    }
  }

  Future<List<ParcelEvent>> getParcelEvents(String parcelId) async {
    try {
      final response = await _dio.get('/parcels/$parcelId/events');
      final responseData = _handleResponse(response);
      
      final List<dynamic> eventsData = responseData['events'] ?? [];
      return eventsData.map((json) => ParcelEvent.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getParcelEvents: $e');
      return [];
    }
  }

  Future<Parcel> updateParcelStatus(String parcelId, String status, {String? location}) async {
    try {
      final response = await _dio.put('/parcels/$parcelId/status', data: {
        'status': status,
        'location': location,
      });
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['parcel'] != null) {
        return Parcel.fromJson(responseData['parcel'] as Map<String, dynamic>);
      } else {
        throw Exception(responseData['message'] ?? 'Erreur lors de la mise à jour');
      }
    } catch (e) {
      debugPrint('❌ Erreur updateParcelStatus: $e');
      rethrow;
    }
  }

  // ==================== MÉTHODES ADMIN GARAGE ====================
  
  Future<List<Parcel>> getGarageParcels({String? status}) async {
    try {
      final response = await _dio.get('/admin/garage/parcels');
      final responseData = _handleResponse(response);
      
      final List<dynamic> parcelsData = responseData['parcels'] ?? [];
      return parcelsData.map((json) => Parcel.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getGarageParcels: $e');
      return [];
    }
  }

  Future<List<User>> getGarageDrivers() async {
    try {
      final response = await _dio.get('/admin/garage/drivers');
      final responseData = _handleResponse(response);
      
      final List<dynamic> driversData = responseData['drivers'] ?? [];
      return driversData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getGarageDrivers: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> assignDriverToParcel(String parcelId, String driverId) async {
    try {
      final response = await _dio.put('/admin/garage/parcels/$parcelId/assign-driver', data: {
        'driverId': driverId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES SUPER ADMIN ====================
  
  // ===== STATISTIQUES =====
  
  Future<Map<String, dynamic>> getSuperAdminStats() async {
    try {
      final response = await _dio.get('/super-admin/stats');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getAdvancedStats() async {
    try {
      final response = await _dio.get('/super-admin/stats/advanced');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getMonthlyReport({int? year, int? month}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (year != null) queryParams['year'] = year;
      if (month != null) queryParams['month'] = month;
      
      final response = await _dio.get('/super-admin/reports/monthly', queryParameters: queryParams);
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ===== GESTION DES UTILISATEURS (CRUD complet) =====
  
  // Récupérer tous les utilisateurs
  Future<List<User>> getAllUsersSuperAdmin() async {
    try {
      final response = await _dio.get('/super-admin/users');
      final responseData = _handleResponse(response);
      
      final List<dynamic> usersData = responseData['users'] ?? [];
      return usersData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllUsersSuperAdmin: $e');
      return [];
    }
  }

  // Récupérer un utilisateur par ID
  Future<User?> getUserByIdSuperAdmin(String userId) async {
    try {
      final response = await _dio.get('/super-admin/users/$userId');
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['user'] != null) {
        return User.fromJson(responseData['user']);
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur getUserByIdSuperAdmin: $e');
      return null;
    }
  }

  // Créer un utilisateur (super admin)
  Future<Map<String, dynamic>> createUserSuperAdmin({
    required String fullName,
    required String email,
    required String phone,
    required String role,
    required String status,
    String? address,
    String? city,
    String? region,
    required String pin,
    String? gender,
    String? vehiclePlate,
    String? vehicleModel,
    String? driverStatus,
    String? garageId,
  }) async {
    try {
      final response = await _dio.post('/super-admin/users', data: {
        'fullName': fullName,
        'email': email,
        'phone': phone,
        'role': role,
        'status': status,
        'address': address,
        'city': city,
        'region': region,
        'pin': pin,
        'gender': gender,
        'vehiclePlate': vehiclePlate,
        'vehicleModel': vehicleModel,
        'driverStatus': driverStatus,
        'garageId': garageId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Mettre à jour un utilisateur (super admin)
  Future<Map<String, dynamic>> updateUserSuperAdmin({
    required String userId,
    required String fullName,
    required String email,
    required String phone,
    required String role,
    required String status,
    String? address,
    String? city,
    String? region,
    String? vehiclePlate,
    String? vehicleModel,
    String? driverStatus,
    String? garageId,
  }) async {
    try {
      final response = await _dio.put('/super-admin/users/$userId', data: {
        'fullName': fullName,
        'email': email,
        'phone': phone,
        'role': role,
        'status': status,
        'address': address,
        'city': city,
        'region': region,
        'vehiclePlate': vehiclePlate,
        'vehicleModel': vehicleModel,
        'driverStatus': driverStatus,
        'garageId': garageId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Mettre à jour le rôle d'un utilisateur
  Future<Map<String, dynamic>> updateUserRoleSuperAdmin(String userId, String role) async {
    try {
      final response = await _dio.patch('/super-admin/users/$userId/role', data: {'role': role});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Mettre à jour le statut d'un utilisateur
  Future<Map<String, dynamic>> updateUserStatusSuperAdmin(String userId, String status) async {
    try {
      final response = await _dio.patch('/super-admin/users/$userId/status', data: {'status': status});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Supprimer un utilisateur
  Future<Map<String, dynamic>> deleteUserSuperAdmin(String userId) async {
    try {
      final response = await _dio.delete('/super-admin/users/$userId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ===== GESTION DES GARAGES (CRUD complet) =====
  
  // Récupérer tous les garages
  Future<List<Garage>> getAllGaragesSuperAdmin() async {
    try {
      final response = await _dio.get('/super-admin/garages');
      final responseData = _handleResponse(response);
      
      final List<dynamic> garagesData = responseData['garages'] ?? [];
      return garagesData.map((json) => Garage.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllGaragesSuperAdmin: $e');
      return [];
    }
  }

  // Récupérer un garage par ID
  Future<Garage?> getGarageByIdSuperAdmin(String garageId) async {
    try {
      final response = await _dio.get('/super-admin/garages/$garageId');
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['garage'] != null) {
        return Garage.fromJson(responseData['garage']);
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur getGarageByIdSuperAdmin: $e');
      return null;
    }
  }

  // Créer un garage (super admin)
  Future<Map<String, dynamic>> createGarageSuperAdmin({
    required String name,
    required String city,
    required String region,
    String? address,
    String? phone,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await _dio.post('/super-admin/garages', data: {
        'name': name,
        'city': city,
        'region': region,
        'address': address,
        'phone': phone,
        'latitude': latitude,
        'longitude': longitude,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Mettre à jour un garage (super admin)
  Future<Map<String, dynamic>> updateGarageSuperAdmin({
    required String garageId,
    required String name,
    required String city,
    required String region,
    String? address,
    String? phone,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await _dio.put('/super-admin/garages/$garageId', data: {
        'name': name,
        'city': city,
        'region': region,
        'address': address,
        'phone': phone,
        'latitude': latitude,
        'longitude': longitude,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Supprimer un garage
  Future<Map<String, dynamic>> deleteGarageSuperAdmin(String garageId) async {
    try {
      final response = await _dio.delete('/super-admin/garages/$garageId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ===== GESTION DES COLIS (CRUD complet) =====
  
  // Récupérer tous les colis
  Future<List<Parcel>> getAllParcelsSuperAdmin() async {
    try {
      final response = await _dio.get('/super-admin/parcels');
      final responseData = _handleResponse(response);
      
      final List<dynamic> parcelsData = responseData['parcels'] ?? [];
      return parcelsData.map((json) => Parcel.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllParcelsSuperAdmin: $e');
      return [];
    }
  }

  // Récupérer un colis par ID
  Future<Parcel?> getParcelByIdSuperAdmin(String parcelId) async {
    try {
      final response = await _dio.get('/super-admin/parcels/$parcelId');
      final responseData = _handleResponse(response);
      
      if (responseData['success'] == true && responseData['parcel'] != null) {
        return Parcel.fromJson(responseData['parcel']);
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur getParcelByIdSuperAdmin: $e');
      return null;
    }
  }

  // Mettre à jour un colis (super admin)
  Future<Map<String, dynamic>> updateParcelSuperAdmin({
    required String parcelId,
    required String status,
    String? driverId,
    double? price,
  }) async {
    try {
      final response = await _dio.put('/super-admin/parcels/$parcelId', data: {
        'status': status,
        'driverId': driverId,
        'price': price,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Supprimer un colis (super admin)
  Future<Map<String, dynamic>> deleteParcelSuperAdmin(String parcelId) async {
    try {
      final response = await _dio.delete('/super-admin/parcels/$parcelId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ===== GESTION DES ADMINS GARAGE =====
  
  // Créer un admin garage
  Future<Map<String, dynamic>> createGarageAdmin({
    required String email,
    required String phone,
    required String fullName,
    required String garageId,
    String pin = '123456',
  }) async {
    try {
      final response = await _dio.post('/super-admin/garage-admins', data: {
        'email': email,
        'phone': phone,
        'fullName': fullName,
        'garageId': garageId,
        'pin': pin,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Récupérer tous les admins garage
  Future<List<User>> getAllGarageAdmins() async {
    try {
      final response = await _dio.get('/super-admin/garage-admins');
      final responseData = _handleResponse(response);
      
      final List<dynamic> adminsData = responseData['admins'] ?? [];
      return adminsData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllGarageAdmins: $e');
      return [];
    }
  }

  // Mettre à jour un admin garage
  Future<Map<String, dynamic>> updateGarageAdmin({
    required String adminId,
    required String garageId,
  }) async {
    try {
      final response = await _dio.put('/super-admin/garage-admins/$adminId', data: {
        'garageId': garageId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Supprimer un admin garage
  Future<Map<String, dynamic>> deleteGarageAdmin(String adminId) async {
    try {
      final response = await _dio.delete('/super-admin/garage-admins/$adminId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ===== GESTION DES CHAUFFEURS =====
  
  // Récupérer tous les chauffeurs
  Future<List<User>> getAllDriversSuperAdmin() async {
    try {
      final response = await _dio.get('/super-admin/drivers');
      final responseData = _handleResponse(response);
      
      final List<dynamic> driversData = responseData['drivers'] ?? [];
      return driversData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllDriversSuperAdmin: $e');
      return [];
    }
  }

  // Changer le statut d'un chauffeur
  Future<Map<String, dynamic>> updateDriverStatusSuperAdmin(String driverId, String status) async {
    try {
      final response = await _dio.patch('/super-admin/drivers/$driverId/status', data: {
        'driverStatus': status,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ===== GESTION DES CLIENTS =====
  
  // Récupérer tous les clients
  Future<List<User>> getAllClientsSuperAdmin() async {
    try {
      final response = await _dio.get('/super-admin/clients');
      final responseData = _handleResponse(response);
      
      final List<dynamic> clientsData = responseData['clients'] ?? [];
      return clientsData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllClientsSuperAdmin: $e');
      return [];
    }
  }

  // ===== RAPPORTS =====
  
  // Rapport journalier
  Future<Map<String, dynamic>> getDailyReport({required DateTime date}) async {
    try {
      final response = await _dio.get('/super-admin/reports/daily', queryParameters: {
        'date': date.toIso8601String().split('T').first,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Rapport annuel
  Future<Map<String, dynamic>> getYearlyReport({required int year}) async {
    try {
      final response = await _dio.get('/super-admin/reports/yearly', queryParameters: {
        'year': year,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // Exporter les données
  Future<Map<String, dynamic>> exportData({
    required String type, // users, parcels, garages, all
    String? format, // csv, json, pdf
  }) async {
    try {
      final response = await _dio.get('/super-admin/export', queryParameters: {
        'type': type,
        'format': format ?? 'json',
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES ADMIN STANDARD ====================
  
  Future<List<User>> getAllUsers() async {
    try {
      final response = await _dio.get('/admin/users');
      final responseData = _handleResponse(response);
      
      final List<dynamic> usersData = responseData['users'] ?? [];
      return usersData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllUsers: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> createUserByAdmin({
    required String fullName,
    required String email,
    required String phone,
    required String role,
    required String status,
    String? address,
    String? city,
    String? region,
    required String pin,
    String? gender,
    String? vehiclePlate,
    String? vehicleModel,
    String? driverStatus,
  }) async {
    try {
      final response = await _dio.post('/admin/users', data: {
        'fullName': fullName,
        'email': email,
        'phone': phone,
        'role': role,
        'status': status,
        'address': address,
        'city': city,
        'region': region,
        'pin': pin,
        'gender': gender,
        'vehiclePlate': vehiclePlate,
        'vehicleModel': vehicleModel,
        'driverStatus': driverStatus,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateUserByAdmin({
    required String userId,
    required String fullName,
    required String email,
    required String phone,
    required String role,
    required String status,
    String? address,
    String? city,
    String? region,
    String? vehiclePlate,
    String? vehicleModel,
    String? driverStatus,
    String? garageId,
  }) async {
    try {
      final response = await _dio.put('/admin/users/$userId', data: {
        'fullName': fullName,
        'email': email,
        'phone': phone,
        'role': role,
        'status': status,
        'address': address,
        'city': city,
        'region': region,
        'vehiclePlate': vehiclePlate,
        'vehicleModel': vehicleModel,
        'driverStatus': driverStatus,
        'garageId': garageId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateUserStatus(String userId, String status) async {
    try {
      final response = await _dio.patch('/admin/users/$userId/status', data: {'status': status});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteUser(String userId) async {
    try {
      final response = await _dio.delete('/admin/users/$userId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> resetUserPin(String userId) async {
    try {
      final response = await _dio.post('/admin/users/$userId/reset-pin');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Parcel>> getAllParcels() async {
    try {
      final response = await _dio.get('/admin/parcels');
      final responseData = _handleResponse(response);
      
      final List<dynamic> parcelsData = responseData['parcels'] ?? [];
      return parcelsData.map((json) => Parcel.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllParcels: $e');
      return [];
    }
  }

  Future<List<Garage>> getAllGarages() async {
    try {
      final response = await _dio.get('/garages');
      final responseData = _handleResponse(response);
      
      if (responseData['success'] != true) {
        debugPrint('❌ Erreur API garages: ${responseData['message']}');
        return [];
      }
      
      final List<dynamic> garagesData = responseData['garages'] ?? [];
      debugPrint('📦 ${garagesData.length} garages reçus de l\'API');
      
      return garagesData.map((json) => Garage.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllGarages: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> createGarage({
    required String name,
    required String city,
    required String region,
    String? address,
    String? phone,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await _dio.post('/admin/garages', data: {
        'name': name,
        'city': city,
        'region': region,
        'address': address,
        'phone': phone,
        'latitude': latitude,
        'longitude': longitude,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateGarage({
    required String garageId,
    required String name,
    required String city,
    required String region,
    String? address,
    String? phone,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await _dio.put('/admin/garages/$garageId', data: {
        'name': name,
        'city': city,
        'region': region,
        'address': address,
        'phone': phone,
        'latitude': latitude,
        'longitude': longitude,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteGarage(String garageId) async {
    try {
      final response = await _dio.delete('/admin/garages/$garageId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
}