// mobile/lib/services/api_service.dart
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';

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
        debugPrint(
            '✅ Réponse reçue: ${response.statusCode} - ${response.requestOptions.path}');
        return handler.next(response);
      },
      onError: (error, handler) async {
        debugPrint(
            '❌ Erreur API: ${error.response?.statusCode} - ${error.requestOptions.path}');
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
    debugPrint(
        '🔐 Token stocké: ${token.substring(0, token.length > 20 ? 20 : token.length)}...');
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

  String _getContentType(String path) {
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
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

  // ==================== AUTHENTIFICATION AVANCÉE ====================

  Future<Map<String, dynamic>> refreshToken() async {
    try {
      final refreshToken = await _storage.read(key: 'refresh_token');
      if (refreshToken == null) {
        return {'success': false, 'message': 'No refresh token'};
      }
      final response = await _dio.post('/auth/refresh', data: {
        'refreshToken': refreshToken,
      });
      final responseData = _handleResponse(response);
      if (responseData['success'] == true && responseData['accessToken'] != null) {
        await setToken(responseData['accessToken']);
        if (responseData['refreshToken'] != null) {
          await _storage.write(key: 'refresh_token', value: responseData['refreshToken']);
        }
      }
      return responseData;
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> forgotPassword(String email) async {
    try {
      final response = await _dio.post('/auth/forgot-password', data: {'email': email});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> resetPassword({
    required String token,
    required String newPassword,
  }) async {
    try {
      final response = await _dio.post('/auth/reset-password', data: {
        'token': token,
        'newPassword': newPassword,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      final response = await _dio.post('/auth/change-password', data: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> verifyEmail(String otpCode) async {
    try {
      final response = await _dio.post('/auth/verify-email', data: {'otpCode': otpCode});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> resendVerificationEmail() async {
    try {
      final response = await _dio.post('/auth/resend-verification');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES UTILISATEUR ====================

  Future<User> getCurrentUser() async {
    try {
      final response = await _dio.get('/auth/me');
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
    String? vehicleColor,
    int? vehicleYear,
  }) async {
    try {
      final currentUser = await getCurrentUser();
      final role = currentUser.role;

      String endpoint;
      switch (role) {
        case UserRole.client:
          endpoint = '/client/profile';
          break;
        case UserRole.driver:
          endpoint = '/driver/profile';
          break;
        case UserRole.admin:
          endpoint = '/garage-admin/profile';
          break;
        case UserRole.superAdmin:
          endpoint = '/super-admin/profile';
          break;
      }

      final response = await _dio.put(endpoint, data: {
        'fullName': fullName,
        'email': email,
        'phone': phone,
        'address': address,
        'city': city,
        'region': region,
        'vehiclePlate': vehiclePlate,
        'vehicleModel': vehicleModel,
        'vehicleColor': vehicleColor,
        'vehicleYear': vehicleYear,
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

  Future<Map<String, dynamic>> updateProfileByRole(String endpoint, Map<String, dynamic> data) async {
    try {
      final response = await _dio.put(
        endpoint,
        data: data,
        options: Options(
          headers: {
            'Content-Type': 'application/json',
          },
        ),
      );
      return _handleResponse(response);
    } catch (e) {
      debugPrint('❌ Erreur updateProfileByRole: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteAccount() async {
    try {
      final response = await _dio.delete(
        '/users/account',
        options: Options(
          headers: {
            'Content-Type': 'application/json',
          },
        ),
      );
      return _handleResponse(response);
    } catch (e) {
      debugPrint('❌ Erreur deleteAccount: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getUserStats() async {
    try {
      final response = await _dio.get(
        '/users/stats',
        options: Options(
          headers: {
            'Content-Type': 'application/json',
          },
        ),
      );
      return _handleResponse(response);
    } catch (e) {
      debugPrint('❌ Erreur getUserStats: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES PARCELS ====================

  Future<List<Parcel>> getMyParcels({String? status}) async {
    try {
      final queryParams = status != null ? {'status': status} : <String, dynamic>{};
      final response = await _dio.get('/client/parcels/my-parcels', queryParameters: queryParams);
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

  Future<Map<String, dynamic>> confirmDelivery(String parcelId,
      {String? signature, String? photoUrl}) async {
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

  Future<String?> uploadParcelPhoto(XFile file, String parcelId) async {
  try {
    final bytes = await file.readAsBytes();
    final base64Image = base64Encode(bytes);
    
    final response = await _dio.post('/upload/parcel-photo', data: {
      'file': base64Image,
      'parcelId': parcelId,
      'filename': file.name,
    });
    
    final responseData = _handleResponse(response);
    if (responseData['success'] == true && responseData['url'] != null) {
      return responseData['url'];
    }
    return null;
  } catch (e) {
    debugPrint('❌ Erreur uploadParcelPhoto: $e');
    return null;
  }
}

Future<String?> uploadParcelVideo(XFile file, String parcelId) async {
  try {
    final bytes = await file.readAsBytes();
    final base64Video = base64Encode(bytes);
    
    final response = await _dio.post('/upload/parcel-video', data: {
      'file': base64Video,
      'parcelId': parcelId,
      'filename': file.name,
    });
    
    final responseData = _handleResponse(response);
    if (responseData['success'] == true && responseData['url'] != null) {
      return responseData['url'];
    }
    return null;
  } catch (e) {
    debugPrint('❌ Erreur uploadParcelVideo: $e');
    return null;
  }
}

// Version simplifiée de createParcel (SANS upload)
Future<Parcel> createParcel(Map<String, dynamic> data) async {
  try {
    final currentUser = await getCurrentUser();
    final role = currentUser.role;

    String endpoint;
    switch (role) {
      case UserRole.client:
        endpoint = '/client/parcels/create';
        break;
      case UserRole.driver:
        endpoint = '/driver/parcels/create';
        break;
      case UserRole.admin:
        endpoint = '/garage-admin/parcels/create';
        break;
      case UserRole.superAdmin:
        endpoint = '/super-admin/parcels/create';
        break;
    }

    // Nettoyer les données (les URLs sont déjà uploadées)
    final cleanedData = {
      'receiverName': data['receiverName'],
      'receiverPhone': data['receiverPhone'],
      'receiverEmail': data['receiverEmail'],
      'description': data['description'],
      'weight': data['weight'],
      'type': data['type'] ?? 'package',
      'departureGarageId': data['departureGarageId'],
      'departureGarageName': data['departureGarageName'],
      'arrivalGarageId': data['arrivalGarageId'],
      'arrivalGarageName': data['arrivalGarageName'],
      'price': data['price'],
      'isUrgent': data['isUrgent'] ?? false,
      'isInsured': data['isInsured'] ?? false,
      'photoUrls': data['photoUrls'] ?? [],  // Déjà des URLs uploadées
      'videoUrls': data['videoUrls'] ?? [],  // Déjà des URLs uploadées
      'driverId': data['driverId'],
      'driverName': data['driverName'],
      'driverPhone': data['driverPhone'],
    };
    
    cleanedData.removeWhere((key, value) => value == null);

    print('📦 Envoi au backend: ${jsonEncode(cleanedData)}');

    final response = await _dio.post(endpoint, data: cleanedData);
    final responseData = _handleResponse(response);
    
    return Parcel.fromMinimalJson(responseData);
    
  } catch (e) {
    debugPrint('❌ Erreur createParcel: $e');
    rethrow;
  }
}

  Future<Parcel> trackParcel(String trackingNumber) async {
    try {
      final response = await _dio.get('/public/parcels/track/$trackingNumber');
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
      final response = await _dio.get('/public/parcels/$parcelId/events');
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
      final currentUser = await getCurrentUser();
      final role = currentUser.role;

      String endpoint;
      switch (role) {
        case UserRole.client:
          endpoint = '/client/parcels/$parcelId/status';
          break;
        case UserRole.driver:
          endpoint = '/driver/parcels/$parcelId/status';
          break;
        case UserRole.admin:
          endpoint = '/garage-admin/parcels/$parcelId/status';
          break;
        case UserRole.superAdmin:
          endpoint = '/super-admin/parcels/$parcelId/status';
          break;
      }

      final response = await _dio.put(endpoint, data: {
        'status': status,
        'location': location,
      });
      final responseData = _handleResponse(response);

      if (responseData['success'] == true) {
        if (responseData['parcel'] != null) {
          return Parcel.fromJson(responseData['parcel'] as Map<String, dynamic>);
        }
        final updatedParcel = await getParcelById(parcelId);
        if (updatedParcel != null) {
          return updatedParcel;
        }
        throw Exception('Statut mis à jour mais impossible de récupérer le colis');
      } else {
        throw Exception(responseData['message'] ?? 'Erreur lors de la mise à jour');
      }
    } catch (e) {
      debugPrint('❌ Erreur updateParcelStatus: $e');
      rethrow;
    }
  }

  Future<Parcel?> getParcelById(String parcelId) async {
  try {
    final currentUser = await getCurrentUser();
    final role = currentUser.role;
    
    // Construire le bon endpoint selon le rôle
    String endpoint;
    switch (role) {
      case UserRole.client:
        endpoint = '/client/parcels/$parcelId';
        break;
      case UserRole.driver:
        endpoint = '/driver/parcels/$parcelId';
        break;
      case UserRole.admin:
        endpoint = '/garage-admin/parcels/$parcelId';
        break;
      case UserRole.superAdmin:
        endpoint = '/super-admin/parcels/$parcelId';
        break;
    }
    
    final response = await _dio.get(endpoint);
    final responseData = _handleResponse(response);
    
    print('📦 getParcelById réponse: $responseData');

    // Ton backend retourne directement le colis, pas un wrapper
    if (responseData['id'] != null) {
      return Parcel.fromJson(responseData);
    }
    
    // Si jamais il y a un wrapper
    if (responseData['success'] == true && responseData['parcel'] != null) {
      return Parcel.fromJson(responseData['parcel'] as Map<String, dynamic>);
    }
    
    return null;
  } catch (e) {
    debugPrint('❌ Erreur getParcelById: $e');
    return null;
  }
}

  Future<Map<String, dynamic>> estimateDeliveryPrice({
    required double weight,
    required String departureGarageId,
    required String arrivalGarageId,
    required String type,
    bool urgent = false,
    bool insured = false,
  }) async {
    try {
      final response = await _dio.post('/parcels/estimate', data: {
        'weight': weight,
        'departureGarageId': departureGarageId,
        'arrivalGarageId': arrivalGarageId,
        'type': type,
        'urgent': urgent,
        'insured': insured,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getParcelTimeline(String parcelId) async {
    try {
      final response = await _dio.get('/parcels/$parcelId/timeline');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> addParcelNote(String parcelId, String note) async {
    try {
      final response = await _dio.post('/parcels/$parcelId/notes', data: {'note': note});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getParcelNotes(String parcelId) async {
    try {
      final response = await _dio.get('/parcels/$parcelId/notes');
      final responseData = _handleResponse(response);
      final List<dynamic> notesData = responseData['notes'] ?? [];
      return notesData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getParcelNotes: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> downloadDeliveryProof(String parcelId) async {
    try {
      final response = await _dio.get('/parcels/$parcelId/proof');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES ADMIN GARAGE ====================

  Future<List<Parcel>> getGarageParcels({String? status}) async {
    try {
      final response = await _dio.get('/garage-admin/parcels');
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
      final response = await _dio.get('/garage-admin/drivers');
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
      final response = await _dio.put('/garage-admin/parcels/$parcelId/assign-driver', data: {
        'driverId': driverId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteParcelAdmin(String parcelId) async {
    try {
      final response = await _dio.delete('/garage-admin/parcels/$parcelId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getGarageDailyReport(DateTime date) async {
    try {
      final response = await _dio.get('/garage-admin/reports/daily', queryParameters: {
        'date': date.toIso8601String().split('T').first,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getGarageMonthlyReport(int year, int month) async {
    try {
      final response = await _dio.get('/garage-admin/reports/monthly', queryParameters: {
        'year': year,
        'month': month,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> exportGarageReport({
    required String format,
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    try {
      final queryParams = <String, dynamic>{'format': format};
      if (startDate != null) {
        queryParams['startDate'] = startDate.toIso8601String().split('T').first;
      }
      if (endDate != null) {
        queryParams['endDate'] = endDate.toIso8601String().split('T').first;
      }

      final response = await _dio.get('/garage-admin/reports/export', queryParameters: queryParams);
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> bulkAssignDrivers(List<Map<String, String>> assignments) async {
    try {
      final response = await _dio.post('/garage-admin/parcels/bulk-assign', data: {
        'assignments': assignments,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== MÉTHODES SUPER ADMIN ====================

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

  Future<Map<String, dynamic>> updateUserRoleSuperAdmin(String userId, String role) async {
    try {
      final response = await _dio.patch('/super-admin/users/$userId/role', data: {'role': role});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateUserStatusSuperAdmin(String userId, String status) async {
    try {
      final response = await _dio.patch('/super-admin/users/$userId/status', data: {'status': status});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteUserSuperAdmin(String userId) async {
    try {
      final response = await _dio.delete('/super-admin/users/$userId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

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

  Future<Map<String, dynamic>> deleteGarageSuperAdmin(String garageId) async {
    try {
      final response = await _dio.delete('/super-admin/garages/$garageId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

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

  Future<Map<String, dynamic>> deleteParcelSuperAdmin(String parcelId) async {
    try {
      final response = await _dio.delete('/super-admin/parcels/$parcelId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getSystemHealth() async {
    try {
      final response = await _dio.get('/super-admin/system/health');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getAuditLogs({
    int page = 1,
    int limit = 50,
    String? userId,
    String? action,
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'page': page,
        'limit': limit,
      };
      if (userId != null) queryParams['userId'] = userId;
      if (action != null) queryParams['action'] = action;
      if (startDate != null) {
        queryParams['startDate'] = startDate.toIso8601String().split('T').first;
      }
      if (endDate != null) {
        queryParams['endDate'] = endDate.toIso8601String().split('T').first;
      }

      final response = await _dio.get('/super-admin/audit-logs', queryParameters: queryParams);
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getSystemConfig() async {
    try {
      final response = await _dio.get('/super-admin/config');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateSystemConfig(Map<String, dynamic> config) async {
    try {
      final response = await _dio.put('/super-admin/config', data: config);
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> backupDatabase() async {
    try {
      final response = await _dio.post('/super-admin/backup');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> restoreDatabase(String backupId) async {
    try {
      final response = await _dio.post('/super-admin/restore', data: {'backupId': backupId});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getBackups() async {
    try {
      final response = await _dio.get('/super-admin/backups');
      final responseData = _handleResponse(response);
      final List<dynamic> backupsData = responseData['backups'] ?? [];
      return backupsData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getBackups: $e');
      return [];
    }
  }

  // ==================== GESTION DES ADMINS GARAGE (SUPER ADMIN) ====================

  Future<Map<String, dynamic>> createGarageAdminSuperAdmin({
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

  Future<List<User>> getAllGarageAdminsSuperAdmin() async {
    try {
      final response = await _dio.get('/super-admin/garage-admins');
      final responseData = _handleResponse(response);
      final List<dynamic> adminsData = responseData['admins'] ?? [];
      return adminsData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllGarageAdminsSuperAdmin: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> updateGarageAdminSuperAdmin({
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

  Future<Map<String, dynamic>> deleteGarageAdminSuperAdmin(String adminId) async {
    try {
      final response = await _dio.delete('/super-admin/garage-admins/$adminId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== GESTION DES CHAUFFEURS ====================

  Future<List<User>> getAllDriversSuperAdmin() async {
    try {
      final response = await _dio.get('/super-admin/users', queryParameters: {
        'role': 'driver',
      });
      final responseData = _handleResponse(response);
      final List<dynamic> usersData = responseData['users'] ?? [];
      return usersData
          .map((json) => User.fromJson(json as Map<String, dynamic>))
          .where((user) => user.role == UserRole.driver)
          .toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllDriversSuperAdmin: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> updateDriverStatusSuperAdmin(String driverId, String status) async {
    try {
      final response = await _dio.patch('/super-admin/users/$driverId/status', data: {
        'status': status,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateDriverDocument({
    required String type,
    required String documentUrl,
  }) async {
    try {
      final response = await _dio.put('/driver/documents', data: {
        'type': type,
        'documentUrl': documentUrl,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getDriverDocuments() async {
    try {
      final response = await _dio.get('/driver/documents');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getDriverSchedule(DateTime date) async {
    try {
      final response = await _dio.get('/driver/schedule', queryParameters: {
        'date': date.toIso8601String().split('T').first,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateDriverSchedule({
    required DateTime date,
    required bool isAvailable,
  }) async {
    try {
      final response = await _dio.post('/driver/schedule', data: {
        'date': date.toIso8601String().split('T').first,
        'isAvailable': isAvailable,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getDriverPerformance() async {
    try {
      final response = await _dio.get('/driver/performance');
      final responseData = _handleResponse(response);
      final List<dynamic> performanceData = responseData['performance'] ?? [];
      return performanceData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getDriverPerformance: $e');
      return [];
    }
  }

  // ==================== GESTION DES CLIENTS ====================

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

  // ==================== STATISTIQUES ====================

  Future<Map<String, dynamic>> getDashboardStats() async {
    try {
      final response = await _dio.get('/admin/stats/dashboard');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getGarageStats(String garageId) async {
    try {
      final response = await _dio.get('/garage-admin/stats');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getDriverStats() async {
    try {
      final response = await _dio.get('/driver/stats');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== NOTIFICATIONS ====================

  Future<List<Map<String, dynamic>>> getNotifications() async {
    try {
      final response = await _dio.get('/notifications');
      final responseData = _handleResponse(response);
      final List<dynamic> notificationsData = responseData['notifications'] ?? [];
      return notificationsData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getNotifications: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> markNotificationAsRead(String notificationId) async {
    try {
      final response = await _dio.patch('/notifications/$notificationId/read');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> markAllNotificationsAsRead() async {
    try {
      final response = await _dio.patch('/notifications/read-all');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> registerFcmToken(String token) async {
    try {
      final response = await _dio.post('/notifications/fcm-token', data: {'token': token});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== PAIEMENTS ====================

  Future<Map<String, dynamic>> initiatePayment({
    required double amount,
    required String method,
    String? parcelId,
    String? phoneNumber,
  }) async {
    try {
      final response = await _dio.post('/payments/initiate', data: {
        'amount': amount,
        'method': method,
        'parcelId': parcelId,
        'phoneNumber': phoneNumber,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> confirmPayment(String paymentId, {String? transactionId}) async {
    try {
      final response = await _dio.post('/payments/$paymentId/confirm', data: {
        'transactionId': transactionId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getPaymentHistory() async {
    try {
      final response = await _dio.get('/payments/history');
      final responseData = _handleResponse(response);
      final List<dynamic> paymentsData = responseData['payments'] ?? [];
      return paymentsData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getPaymentHistory: $e');
      return [];
    }
  }

  // ==================== UPLOAD ====================

  Future<String?> uploadXFile(XFile file, String type) async {
    try {
      final bytes = await file.readAsBytes();
      final base64Image = base64Encode(bytes);

      final response = await _dio.post('/upload/base64', data: {
        'file': base64Image,
        'type': type,
        'filename': file.name,
        'contentType': _getContentType(file.name),
      });

      final responseData = _handleResponse(response);
      if (responseData['success'] == true && responseData['url'] != null) {
        return responseData['url'];
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur uploadXFile: $e');
      return null;
    }
  }

  Future<String?> uploadFile(File file, String type) async {
    if (kIsWeb) {
      debugPrint('⚠️ uploadFile ne fonctionne pas sur Web, utilisez uploadXFile à la place');
      return null;
    }

    try {
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(
          file.path,
          filename: file.path.split('/').last,
          contentType: MediaType('image', 'jpeg'),
        ),
        'type': type,
      });

      final response = await _dio.post('/upload', data: formData);
      final responseData = _handleResponse(response);
      if (responseData['success'] == true && responseData['url'] != null) {
        return responseData['url'];
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur uploadFile: $e');
      return null;
    }
  }

  Future<String?> uploadFileFromXFile(XFile file, String type) async {
    try {
      if (kIsWeb) {
        final bytes = await file.readAsBytes();
        final formData = FormData.fromMap({
          'file': MultipartFile.fromBytes(
            bytes,
            filename: file.name,
            contentType: MediaType('image', 'jpeg'),
          ),
          'type': type,
        });

        final response = await _dio.post('/upload', data: formData);
        final responseData = _handleResponse(response);
        if (responseData['success'] == true && responseData['url'] != null) {
          return responseData['url'];
        }
        return null;
      } else {
        final formData = FormData.fromMap({
          'file': await MultipartFile.fromFile(
            file.path,
            filename: file.name,
            contentType: MediaType('image', 'jpeg'),
          ),
          'type': type,
        });

        final response = await _dio.post('/upload', data: formData);
        final responseData = _handleResponse(response);
        if (responseData['success'] == true && responseData['url'] != null) {
          return responseData['url'];
        }
        return null;
      }
    } catch (e) {
      debugPrint('❌ Erreur uploadFileFromXFile: $e');
      return null;
    }
  }

  Future<List<String>> uploadMultipleFiles(List<XFile> files, String type) async {
    try {
      final List<String> urls = [];

      for (final file in files) {
        final url = await uploadXFile(file, type);
        if (url != null) {
          urls.add(url);
        }
      }

      return urls;
    } catch (e) {
      debugPrint('❌ Erreur uploadMultipleFiles: $e');
      return [];
    }
  }

  Future<List<String>> uploadMultipleFilesFromXFile(List<XFile> files, String type) async {
    try {
      final List<String> urls = [];

      for (final file in files) {
        final url = await uploadFileFromXFile(file, type);
        if (url != null) {
          urls.add(url);
        }
      }

      return urls;
    } catch (e) {
      debugPrint('❌ Erreur uploadMultipleFilesFromXFile: $e');
      return [];
    }
  }

  Future<String?> uploadProfilePhoto(XFile file) async {
    return uploadXFile(file, 'profile');
  }

  Future<String?> uploadProfilePhotoFromFile(dynamic file) async {
    try {
      if (kIsWeb && file is XFile) {
        final bytes = await file.readAsBytes();
        final formData = FormData.fromMap({
          'file': MultipartFile.fromBytes(
            bytes,
            filename: file.name,
          ),
          'type': 'profile',
        });

        final response = await _dio.post(
          '/upload',
          data: formData,
          options: Options(
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          ),
        );

        final responseData = _handleResponse(response);
        if (responseData['success'] == true && responseData['url'] != null) {
          return responseData['url'];
        }
        return null;
      } else if (file is XFile) {
        final formData = FormData.fromMap({
          'file': await MultipartFile.fromFile(
            file.path,
            filename: file.name,
          ),
          'type': 'profile',
        });

        final response = await _dio.post(
          '/upload',
          data: formData,
          options: Options(
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          ),
        );

        final responseData = _handleResponse(response);
        if (responseData['success'] == true && responseData['url'] != null) {
          return responseData['url'];
        }
        return null;
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur uploadProfilePhotoFromFile: $e');
      return null;
    }
  }

  Future<Map<String, dynamic>> uploadFileDirect(FormData formData) async {
    try {
      final response = await _dio.post(
        '/upload',
        data: formData,
        options: Options(
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        ),
      );
      return _handleResponse(response);
    } catch (e) {
      debugPrint('❌ Erreur uploadFileDirect: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  // Future<String?> uploadParcelPhoto(XFile file, String parcelId) async {
  //   return uploadXFile(file, 'parcel/$parcelId');
  // }

  Future<Map<String, dynamic>> updateProfilePhoto(String photoUrl) async {
    try {
      final currentUser = await getCurrentUser();
      final role = currentUser.role;

      String endpoint;
      switch (role) {
        case UserRole.client:
          endpoint = '/client/profile-photo';
          break;
        case UserRole.driver:
          endpoint = '/driver/profile-photo';
          break;
        case UserRole.admin:
          endpoint = '/garage-admin/profile-photo';
          break;
        case UserRole.superAdmin:
          endpoint = '/super-admin/profile-photo';
          break;
      }

      final response = await _dio.put(
        endpoint,
        data: {'photoUrl': photoUrl},
      );
      return _handleResponse(response);
    } catch (e) {
      debugPrint('❌ Erreur updateProfilePhoto: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateProfilePhotoUrl(String photoUrl) async {
    try {
      final currentUser = await getCurrentUser();
      final role = currentUser.role;

      String endpoint;
      switch (role) {
        case UserRole.client:
          endpoint = '/client/profile-photo';
          break;
        case UserRole.driver:
          endpoint = '/driver/profile-photo';
          break;
        case UserRole.admin:
          endpoint = '/garage-admin/profile-photo';
          break;
        case UserRole.superAdmin:
          endpoint = '/super-admin/profile-photo';
          break;
      }

      final response = await _dio.put(endpoint, data: {'photoUrl': photoUrl});
      return _handleResponse(response);
    } catch (e) {
      debugPrint('❌ Erreur updateProfilePhotoUrl: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> uploadAndUpdateProfilePhoto(XFile file) async {
    try {
      final photoUrl = await uploadProfilePhoto(file);

      if (photoUrl == null) {
        return {'success': false, 'message': 'Erreur lors de l\'upload'};
      }

      final response = await updateProfilePhotoUrl(photoUrl);

      return response;
    } catch (e) {
      debugPrint('❌ Erreur uploadAndUpdateProfilePhoto: $e');
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<String?> uploadProfilePhotoFile(File file) async {
    return uploadFile(file, 'profile');
  }

  // ==================== MÉTHODES ADMIN STANDARD ====================

  Future<List<Garage>> getAllGarages() async {
    try {
      final response = await _dio.get('/public/garages');
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

  Future<Map<String, dynamic>> updateUserStatusAdmin(String userId, String status) async {
    try {
      final response = await _dio.patch('/admin/users/$userId/status', data: {'status': status});
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteUserAdmin(String userId) async {
    try {
      final response = await _dio.delete('/admin/users/$userId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> resetUserPinAdmin(String userId) async {
    try {
      final response = await _dio.post('/admin/users/$userId/reset-pin');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Parcel>> getAllParcelsAdmin() async {
    try {
      final response = await _dio.get('/admin/parcels');
      final responseData = _handleResponse(response);
      final List<dynamic> parcelsData = responseData['parcels'] ?? [];
      return parcelsData.map((json) => Parcel.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAllParcelsAdmin: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> createGarageAdmin({
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

  Future<Map<String, dynamic>> updateGarageAdmin({
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

  Future<Map<String, dynamic>> deleteGarageAdmin(String garageId) async {
    try {
      final response = await _dio.delete('/admin/garages/$garageId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== RECHERCHE PUBLIQUE DE CHAUFFEURS ====================

  Future<List<User>> searchDriversPublic({String? query}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (query != null && query.isNotEmpty) {
        queryParams['query'] = query;
      }
      final response = await _dio.get('/public/drivers/search', queryParameters: queryParams);
      final responseData = _handleResponse(response);
      final List<dynamic> driversData = responseData['drivers'] ?? [];
      return driversData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur searchDriversPublic: $e');
      return [];
    }
  }

  Future<User?> getDriverByIdPublic(String driverId) async {
    try {
      final response = await _dio.get('/public/drivers/$driverId');
      final responseData = _handleResponse(response);
      if (responseData['success'] == true && responseData['driver'] != null) {
        return User.fromJson(responseData['driver']);
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur getDriverByIdPublic: $e');
      return null;
    }
  }

  Future<List<User>> getDriversByGaragePublic(String garageId) async {
    try {
      final response = await _dio.get('/public/drivers/garage/$garageId');
      final responseData = _handleResponse(response);
      final List<dynamic> driversData = responseData['drivers'] ?? [];
      return driversData.map((json) => User.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('❌ Erreur getDriversByGaragePublic: $e');
      return [];
    }
  }

  // ==================== VÉHICULES ====================

  Future<Map<String, dynamic>> addVehicle({
    required String plateNumber,
    required String model,
    required String type,
    required int capacity,
    required String garageId,
  }) async {
    try {
      final response = await _dio.post('/vehicles', data: {
        'plateNumber': plateNumber,
        'model': model,
        'type': type,
        'capacity': capacity,
        'garageId': garageId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getVehicles({String? garageId}) async {
    try {
      final queryParams = garageId != null ? {'garageId': garageId} : <String, dynamic>{};
      final response = await _dio.get('/vehicles', queryParameters: queryParams);
      final responseData = _handleResponse(response);
      final List<dynamic> vehiclesData = responseData['vehicles'] ?? [];
      return vehiclesData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getVehicles: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> assignVehicleToDriver(String vehicleId, String driverId) async {
    try {
      final response = await _dio.put('/vehicles/$vehicleId/assign', data: {
        'driverId': driverId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> updateVehicleStatus(String vehicleId, bool isAvailable) async {
    try {
      final response = await _dio.patch('/vehicles/$vehicleId/status', data: {
        'isAvailable': isAvailable,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteVehicle(String vehicleId) async {
    try {
      final response = await _dio.delete('/vehicles/$vehicleId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== RAPPORTS ET EXPORTATIONS ====================

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

  Future<Map<String, dynamic>> exportData({
    required String type,
    String? format,
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

  Future<String?> exportReport({
    required String reportType,
    required String format,
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'reportType': reportType,
        'format': format,
      };
      if (startDate != null) {
        queryParams['startDate'] = startDate.toIso8601String().split('T').first;
      }
      if (endDate != null) {
        queryParams['endDate'] = endDate.toIso8601String().split('T').first;
      }

      final response = await _dio.get('/reports/export', queryParameters: queryParams);
      final responseData = _handleResponse(response);
      if (responseData['success'] == true && responseData['url'] != null) {
        return responseData['url'];
      }
      return null;
    } catch (e) {
      debugPrint('❌ Erreur exportReport: $e');
      return null;
    }
  }

  // ==================== GÉOLOCALISATION ====================

  Future<Map<String, dynamic>> updateDriverLocation({
    required double latitude,
    required double longitude,
  }) async {
    try {
      final response = await _dio.post('/driver/location', data: {
        'latitude': latitude,
        'longitude': longitude,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getDriverLocation(String driverId) async {
    try {
      final response = await _dio.get('/driver/$driverId/location');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getParcelLocation(String parcelId) async {
    try {
      final response = await _dio.get('/parcels/$parcelId/location');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== ÉVALUATIONS ====================

  Future<Map<String, dynamic>> submitRating({
    required String parcelId,
    required int rating,
    String? comment,
  }) async {
    try {
      final response = await _dio.post('/ratings', data: {
        'parcelId': parcelId,
        'rating': rating,
        'comment': comment,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getDriverRatings(String driverId) async {
    try {
      final response = await _dio.get('/ratings/driver/$driverId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== SUPPORT ====================

  Future<Map<String, dynamic>> sendSupportMessage({
    required String subject,
    required String message,
    List<String>? attachments,
  }) async {
    try {
      final response = await _dio.post('/support/messages', data: {
        'subject': subject,
        'message': message,
        'attachments': attachments,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getSupportMessages() async {
    try {
      final response = await _dio.get('/support/messages');
      final responseData = _handleResponse(response);
      final List<dynamic> messagesData = responseData['messages'] ?? [];
      return messagesData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getSupportMessages: $e');
      return [];
    }
  }

  // ==================== VÉRIFICATION D'IDENTITÉ ====================

  Future<Map<String, dynamic>> verifyIdentity({
    required String nationalId,
    required String fullName,
    required DateTime birthDate,
  }) async {
    try {
      final response = await _dio.post('/identity/verify', data: {
        'nationalId': nationalId,
        'fullName': fullName,
        'birthDate': birthDate.toIso8601String(),
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> uploadIdentityDocument(File file, String type) async {
    try {
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(file.path),
        'type': type,
      });
      final response = await _dio.post('/identity/upload', data: formData);
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> getIdentityStatus() async {
    try {
      final response = await _dio.get('/identity/status');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== PROMOTIONS ET COUPONS ====================

  Future<Map<String, dynamic>> validateCoupon(String code, double amount) async {
    try {
      final response = await _dio.post('/coupons/validate', data: {
        'code': code,
        'amount': amount,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getAvailableCoupons() async {
    try {
      final response = await _dio.get('/coupons/available');
      final responseData = _handleResponse(response);
      final List<dynamic> couponsData = responseData['coupons'] ?? [];
      return couponsData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAvailableCoupons: $e');
      return [];
    }
  }

  // ==================== MESSAGERIE ====================

  Future<Map<String, dynamic>> sendMessage({
    required String receiverId,
    required String message,
    String? parcelId,
  }) async {
    try {
      final response = await _dio.post('/messages', data: {
        'receiverId': receiverId,
        'message': message,
        'parcelId': parcelId,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getConversations() async {
    try {
      final response = await _dio.get('/messages/conversations');
      final responseData = _handleResponse(response);
      final List<dynamic> conversationsData = responseData['conversations'] ?? [];
      return conversationsData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getConversations: $e');
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> getMessages(String conversationId, {int page = 1}) async {
    try {
      final response = await _dio.get('/messages/$conversationId', queryParameters: {
        'page': page,
      });
      final responseData = _handleResponse(response);
      final List<dynamic> messagesData = responseData['messages'] ?? [];
      return messagesData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getMessages: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> markMessageAsRead(String messageId) async {
    try {
      final response = await _dio.patch('/messages/$messageId/read');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== FAVORIS ====================

  Future<Map<String, dynamic>> addFavoriteGarage(String garageId) async {
    try {
      final response = await _dio.post('/favorites/garages/$garageId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> removeFavoriteGarage(String garageId) async {
    try {
      final response = await _dio.delete('/favorites/garages/$garageId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getFavoriteGarages() async {
    try {
      final response = await _dio.get('/favorites/garages');
      final responseData = _handleResponse(response);
      final List<dynamic> garagesData = responseData['garages'] ?? [];
      return garagesData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getFavoriteGarages: $e');
      return [];
    }
  }

  // ==================== ADRESSES ====================

  Future<Map<String, dynamic>> addAddress({
    required String label,
    required String address,
    required String city,
    required String region,
    double? latitude,
    double? longitude,
    bool isDefault = false,
  }) async {
    try {
      final response = await _dio.post('/addresses', data: {
        'label': label,
        'address': address,
        'city': city,
        'region': region,
        'latitude': latitude,
        'longitude': longitude,
        'isDefault': isDefault,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getAddresses() async {
    try {
      final response = await _dio.get('/addresses');
      final responseData = _handleResponse(response);
      final List<dynamic> addressesData = responseData['addresses'] ?? [];
      return addressesData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getAddresses: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> updateAddress(String addressId, Map<String, dynamic> data) async {
    try {
      final response = await _dio.put('/addresses/$addressId', data: data);
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> deleteAddress(String addressId) async {
    try {
      final response = await _dio.delete('/addresses/$addressId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<Map<String, dynamic>> setDefaultAddress(String addressId) async {
    try {
      final response = await _dio.patch('/addresses/$addressId/default');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  // ==================== RECHERCHE ====================

  Future<Map<String, dynamic>> searchGlobal(String query, {int limit = 20}) async {
    try {
      final response = await _dio.get('/search', queryParameters: {
        'q': query,
        'limit': limit,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> searchParcels({
    required String query,
    String? status,
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    try {
      final queryParams = <String, dynamic>{'q': query};
      if (status != null) queryParams['status'] = status;
      if (startDate != null) {
        queryParams['startDate'] = startDate.toIso8601String().split('T').first;
      }
      if (endDate != null) {
        queryParams['endDate'] = endDate.toIso8601String().split('T').first;
      }

      final response = await _dio.get('/search/parcels', queryParameters: queryParams);
      final responseData = _handleResponse(response);
      final List<dynamic> parcelsData = responseData['parcels'] ?? [];
      return parcelsData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur searchParcels: $e');
      return [];
    }
  }

  // ==================== WEBHOOKS ====================

  Future<Map<String, dynamic>> registerWebhook({
    required String url,
    required List<String> events,
  }) async {
    try {
      final response = await _dio.post('/webhooks', data: {
        'url': url,
        'events': events,
      });
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  Future<List<Map<String, dynamic>>> getWebhooks() async {
    try {
      final response = await _dio.get('/webhooks');
      final responseData = _handleResponse(response);
      final List<dynamic> webhooksData = responseData['webhooks'] ?? [];
      return webhooksData.map((json) => json as Map<String, dynamic>).toList();
    } catch (e) {
      debugPrint('❌ Erreur getWebhooks: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>> deleteWebhook(String webhookId) async {
    try {
      final response = await _dio.delete('/webhooks/$webhookId');
      return _handleResponse(response);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
}