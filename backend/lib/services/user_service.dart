// lib/services/user_service.dart
import 'package:procolis_backend/services/database_service.dart';
import 'package:uuid/uuid.dart';

class UserService {
  
  // Récupérer un utilisateur par son ID avec TOUS les champs
  Future<Map<String, dynamic>?> getUserById(String userId) async {
    final db = await DatabaseService.getInstance();
    
    try {
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
      
      if (result.isEmpty) return null;
      
      final row = result.first;
      
      DateTime? toDate(dynamic v) {
        if (v == null) return null;
        if (v is DateTime) return v;
        return DateTime.tryParse(v.toString());
      }
      
      return {
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
    } catch (e) {
      print('❌ Erreur getUserById: $e');
      return null;
    }
  }
  
  // Récupérer tous les utilisateurs (version simplifiée pour les listes)
  Future<List<Map<String, dynamic>>> getAllUsers() async {
    final db = await DatabaseService.getInstance();
    
    try {
      final result = await db.connection.execute('''
        SELECT 
          u.id, u.email, u.phone, u.full_name, u.role, u.status, 
          u.created_at, u.last_login, u.is_approved,
          g.name AS garage_name
        FROM users u
        LEFT JOIN garages g ON g.id = u.garage_id
        ORDER BY u.created_at DESC
      ''');
      
      return result.map((row) => ({
        'id': row[0],
        'email': row[1],
        'phone': row[2],
        'fullName': row[3],
        'role': row[4],
        'status': row[5],
        'createdAt': (row[6] as DateTime).toIso8601String(),
        'lastLogin': row[7] != null ? (row[7] as DateTime).toIso8601String() : null,
        'isApproved': row[8] ?? false,
        'garageName': row[9],
      })).toList();
    } catch (e) {
      print('❌ Erreur getAllUsers: $e');
      return [];
    }
  }
  
  // Mettre à jour le profil utilisateur avec TOUS les champs
  Future<Map<String, dynamic>> updateProfile(String userId, Map<String, dynamic> data) async {
    final db = await DatabaseService.getInstance();
    
    try {
      // Mapping des champs camelCase -> snake_case
      final fieldMapping = {
        'fullName': 'full_name',
        'email': 'email',
        'phone': 'phone',
        'address': 'address',
        'city': 'city',
        'region': 'region',
        'country': 'country',
        'vehiclePlate': 'vehicle_plate',
        'vehicleModel': 'vehicle_model',
        'vehicleColor': 'vehicle_color',
        'vehicleYear': 'vehicle_year',
        'driverStatus': 'driver_status',
        'gender': 'gender',
        'garageId': 'garage_id',
        'profilePhoto': 'profile_photo',
        'birthDate': 'birth_date',
        'nationalId': 'national_id',
        'emergencyContact': 'emergency_contact',
        'emergencyPhone': 'emergency_phone',
        'fcmToken': 'fcm_token',
      };
      
      final fields = <String>[];
      final values = <dynamic>[];
      var index = 1;
      
      for (var entry in data.entries) {
        final dbField = fieldMapping[entry.key];
        if (dbField != null && entry.value != null) {
          fields.add('$dbField = \$$index');
          values.add(entry.value);
          index++;
        }
      }
      
      if (fields.isEmpty) {
        return {'success': false, 'message': 'Aucune donnée à mettre à jour'};
      }
      
      values.add(userId);
      final query = '''
        UPDATE users 
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = \$$index
        RETURNING id, email, phone, full_name, role
      ''';
      
      final result = await db.connection.execute(query, parameters: values);
      
      if (result.isEmpty) {
        return {'success': false, 'message': 'Utilisateur non trouvé'};
      }
      
      return {
        'success': true,
        'message': 'Profil mis à jour avec succès',
        'user': {
          'id': result.first[0],
          'email': result.first[1],
          'phone': result.first[2],
          'fullName': result.first[3],
          'role': result.first[4],
        }
      };
    } catch (e) {
      print('❌ Erreur updateProfile: $e');
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Mettre à jour le PIN
  Future<Map<String, dynamic>> updatePin(String userId, String currentPin, String newPin) async {
    final db = await DatabaseService.getInstance();
    
    try {
      // Vérifier l'ancien PIN
      final checkResult = await db.connection.execute(
        'SELECT pin FROM users WHERE id = \$1 AND pin = \$2',
        parameters: [userId, currentPin],
      );
      
      if (checkResult.isEmpty) {
        return {'success': false, 'message': 'PIN actuel incorrect'};
      }
      
      await db.connection.execute(
        'UPDATE users SET pin = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [userId, newPin],
      );
      
      return {'success': true, 'message': 'PIN modifié avec succès'};
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Créer un nouvel utilisateur avec TOUS les champs
  Future<Map<String, dynamic>> createUser(Map<String, dynamic> data) async {
    final db = await DatabaseService.getInstance();
    final userId = const Uuid().v4();
    
    try {
      await db.connection.execute('''
        INSERT INTO users (
          id, email, phone, full_name, role, status, pin,
          address, city, region, country,
          vehicle_plate, vehicle_model, vehicle_color, vehicle_year,
          driver_status, gender, garage_id, profile_photo,
          is_email_verified, is_phone_verified,
          birth_date, national_id, emergency_contact, emergency_phone,
          fcm_token, is_approved, approved_by, approved_at,
          created_by, created_at, updated_at
        )
        VALUES (
          \$1, \$2, \$3, \$4, \$5, \$6, \$7,
          \$8, \$9, \$10, \$11,
          \$12, \$13, \$14, \$15,
          \$16, \$17, \$18, \$19,
          \$20, \$21,
          \$22, \$23, \$24, \$25,
          \$26, \$27, \$28, \$29,
          \$30, NOW(), NOW()
        )
      ''', parameters: [
        userId,
        data['email'],
        data['phone'],
        data['fullName'],
        data['role'] ?? 'client',
        data['status'] ?? 'active',
        data['pin'] ?? '123456',
        data['address'],
        data['city'],
        data['region'],
        data['country'] ?? 'Sénégal',
        data['vehiclePlate'],
        data['vehicleModel'],
        data['vehicleColor'],
        data['vehicleYear'],
        data['driverStatus'] ?? 'offline',
        data['gender'],
        data['garageId'],
        data['profilePhoto'],
        data['isEmailVerified'] ?? false,
        data['isPhoneVerified'] ?? false,
        data['birthDate'],
        data['nationalId'],
        data['emergencyContact'],
        data['emergencyPhone'],
        data['fcmToken'],
        data['isApproved'] ?? false,
        data['approvedBy'],
        data['approvedAt'],
        data['createdBy'],
      ]);
      
      return {
        'success': true,
        'message': 'Utilisateur créé avec succès',
        'userId': userId
      };
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Mettre à jour un utilisateur (admin) avec TOUS les champs
  Future<Map<String, dynamic>> updateUser(String userId, Map<String, dynamic> data) async {
    final db = await DatabaseService.getInstance();
    
    try {
      final fields = <String>[];
      final values = <dynamic>[];
      var index = 1;
      
      final allowedFields = {
        'fullName': 'full_name',
        'email': 'email',
        'phone': 'phone',
        'role': 'role',
        'status': 'status',
        'address': 'address',
        'city': 'city',
        'region': 'region',
        'country': 'country',
        'vehiclePlate': 'vehicle_plate',
        'vehicleModel': 'vehicle_model',
        'vehicleColor': 'vehicle_color',
        'vehicleYear': 'vehicle_year',
        'driverStatus': 'driver_status',
        'gender': 'gender',
        'garageId': 'garage_id',
        'profilePhoto': 'profile_photo',
        'isApproved': 'is_approved',
      };
      
      for (var entry in data.entries) {
        final dbField = allowedFields[entry.key];
        if (dbField != null && entry.value != null) {
          fields.add('$dbField = \$$index');
          values.add(entry.value);
          index++;
        }
      }
      
      if (fields.isEmpty) {
        return {'success': false, 'message': 'Aucune donnée à mettre à jour'};
      }
      
      values.add(userId);
      final query = '''
        UPDATE users 
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = \$$index
      ''';
      
      await db.connection.execute(query, parameters: values);
      
      return {'success': true, 'message': 'Utilisateur mis à jour avec succès'};
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Mettre à jour le rôle d'un utilisateur
  Future<Map<String, dynamic>> updateUserRole(String userId, String role) async {
    final db = await DatabaseService.getInstance();
    
    try {
      await db.connection.execute(
        'UPDATE users SET role = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [userId, role],
      );
      return {'success': true, 'message': 'Rôle mis à jour avec succès'};
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Mettre à jour le statut d'un utilisateur
  Future<Map<String, dynamic>> updateUserStatus(String userId, String status) async {
    final db = await DatabaseService.getInstance();
    
    try {
      await db.connection.execute(
        'UPDATE users SET status = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [userId, status],
      );
      return {'success': true, 'message': 'Statut mis à jour avec succès'};
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Approuver un utilisateur
  Future<Map<String, dynamic>> approveUser(String userId, String approvedBy) async {
    final db = await DatabaseService.getInstance();
    
    try {
      await db.connection.execute('''
        UPDATE users 
        SET is_approved = TRUE, approved_by = \$2, approved_at = NOW(), updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [userId, approvedBy]);
      
      return {'success': true, 'message': 'Utilisateur approuvé avec succès'};
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Mettre à jour le token FCM
  Future<Map<String, dynamic>> updateFcmToken(String userId, String fcmToken) async {
    final db = await DatabaseService.getInstance();
    
    try {
      await db.connection.execute(
        'UPDATE users SET fcm_token = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [userId, fcmToken],
      );
      return {'success': true, 'message': 'Token FCM mis à jour'};
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Supprimer un utilisateur
  Future<Map<String, dynamic>> deleteUser(String userId) async {
    final db = await DatabaseService.getInstance();
    
    try {
      await db.connection.execute('DELETE FROM users WHERE id = \$1', parameters: [userId]);
      return {'success': true, 'message': 'Utilisateur supprimé avec succès'};
    } catch (e) {
      return {'success': false, 'message': 'Erreur: ${e.toString()}'};
    }
  }
  
  // Mettre à jour la dernière activité
  Future<void> updateLastActive(String userId) async {
    final db = await DatabaseService.getInstance();
    
    try {
      await db.connection.execute(
        'UPDATE users SET last_active = NOW() WHERE id = \$1',
        parameters: [userId],
      );
    } catch (e) {
      print('❌ Erreur updateLastActive: $e');
    }
  }
}