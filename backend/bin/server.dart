import 'dart:convert';

import 'package:dotenv/dotenv.dart';
import 'package:logging/logging.dart';
import 'package:procolis_backend/services/database_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

import '../lib/controllers/auth_controller.dart';
import '../lib/services/email_service.dart';

final _uuid = Uuid();

String? extractUserIdFromToken(Request request) {
  final authHeader = request.headers['Authorization'];
  if (authHeader == null || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  final token = authHeader.substring(7);
  final parts = token.split('_');
  if (parts.length < 2) return null;
  return parts[1];
}

Future<bool> isSuperAdmin(String userId) async {
  final db = await DatabaseService.getInstance();
  final result = await db.connection.execute(
    'SELECT role FROM users WHERE id = \$1',
    parameters: [userId],
  );
  return result.isNotEmpty && result.first[0] == 'super_admin';
}

Future<bool> isAdmin(String userId) async {
  final db = await DatabaseService.getInstance();
  final result = await db.connection.execute(
    'SELECT role FROM users WHERE id = \$1',
    parameters: [userId],
  );
  return result.isNotEmpty && (result.first[0] == 'admin' || result.first[0] == 'super_admin');
}

Future<bool> isDriver(String userId) async {
  final db = await DatabaseService.getInstance();
  final result = await db.connection.execute(
    'SELECT role FROM users WHERE id = \$1',
    parameters: [userId],
  );
  return result.isNotEmpty && result.first[0] == 'driver';
}

// Middleware CORS personnalisé
Middleware corsMiddleware() {
  return (Handler handler) {
    return (Request request) async {
      final corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, Content-Type, Accept, Authorization, X-Requested-With, X-Custom-Header',
        'Access-Control-Allow-Credentials': 'true',
      };
      
      if (request.method == 'OPTIONS') {
        return Response.ok('', headers: corsHeaders);
      }
      
      final response = await handler(request);
      return response.change(headers: corsHeaders);
    };
  };
}

void main() async {
  Logger.root.level = Level.INFO;
  Logger.root.onRecord.listen((record) {
    print('${record.level.name}: ${record.time}: ${record.message}');
  });

  print('🔄 Initialisation de la base de données...');
  final db = await DatabaseService.getInstance();
  print('✅ Base de données initialisée avec succès');
  
  if (!db.isConnected) {
    print('❌ La base de données n\'est pas connectée!');
    return;
  }

  var env = DotEnv(includePlatformEnvironment: true)..load();

  final emailService = EmailService(
    smtpHost: env['SMTP_HOST'] ?? 'smtp.gmail.com',
    smtpPort: int.parse(env['SMTP_PORT'] ?? '587'),
    smtpSecure: env['SMTP_SECURE'] == 'true',
    smtpUser: env['SMTP_USER'] ?? '',
    smtpPass: env['SMTP_PASS'] ?? '',
    smtpFrom: env['SMTP_FROM'] ?? 'PRO COLIS <noreply@proscolis.sn>',
  );

  final authController = AuthController(emailService: emailService);

  print('📧 Service email configuré avec: ${env['SMTP_USER']}');

  final router = Router();
  
  // ==================== ROUTES PUBLIQUES ====================
  router.mount('/auth', authController.router);
  
  router.post('/auth/login-with-pin', (Request request) async {
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      final pin = data['pin']?.toString() ?? '';
      
      final result = await db.connection.execute(
        'SELECT id, email, phone, full_name, role, pin, created_at FROM users WHERE pin = \$1',
        parameters: [pin],
      );
      
      if (result.isEmpty) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'PIN incorrect'}));
      }
      
      final userId = result.first[0] as String;
      final user = {
        'id': userId,
        'email': result.first[1] as String,
        'phone': result.first[2] as String,
        'fullName': result.first[3] as String,
        'role': result.first[4] as String,
        'pin': result.first[5].toString(),
        'createdAt': (result.first[6] as DateTime).toIso8601String(),
      };
      
      final token = 'token_${userId}_${DateTime.now().millisecondsSinceEpoch}';
      
      return Response.ok(jsonEncode({
        'success': true,
        'accessToken': token,
        'user': user,
      }));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });
  
  router.get('/health', (Request request) async {
    try {
      final userCount = await db.connection.execute('SELECT COUNT(*) FROM users');
      final garageCount = await db.connection.execute('SELECT COUNT(*) FROM garages');
      final parcelCount = await db.connection.execute('SELECT COUNT(*) FROM parcels');
      
      return Response.ok(jsonEncode({
        'status': 'ok',
        'timestamp': DateTime.now().toIso8601String(),
        'stats': {'users': userCount.first[0], 'garages': garageCount.first[0], 'parcels': parcelCount.first[0]}
      }));
    } catch (e) {
      return Response.ok(jsonEncode({'status': 'ok', 'timestamp': DateTime.now().toIso8601String()}));
    }
  });
  
  router.get('/', (Request request) {
    return Response.ok('{"message": "PRO COLIS API is running", "version": "1.0.0"}');
  });
  
  router.get('/garages', (Request request) async {
    try {
      final result = await db.connection.execute('SELECT id, name, city, region FROM garages ORDER BY name');
      
      final garages = result.map((row) => ({
        'id': row[0], 'name': row[1], 'city': row[2], 'region': row[3],
      })).toList();
      
      return Response.ok(jsonEncode({'success': true, 'garages': garages}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // ==================== ROUTES CLIENTS ====================
  
  router.get('/users/me', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    }
    
    try {
      final result = await db.connection.execute(
        'SELECT id, email, phone, full_name, role, status, address, city, region, created_at FROM users WHERE id = \$1',
        parameters: [userId],
      );
      
      if (result.isEmpty) {
        return Response.notFound(jsonEncode({'success': false, 'message': 'Utilisateur non trouvé'}));
      }
      
      final user = {
        'id': result.first[0],
        'email': result.first[1],
        'phone': result.first[2],
        'fullName': result.first[3],
        'role': result.first[4],
        'status': result.first[5],
        'address': result.first[6],
        'city': result.first[7],
        'region': result.first[8],
        'createdAt': (result.first[9] as DateTime).toIso8601String(),
      };
      
      return Response.ok(jsonEncode({'success': true, 'user': user}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/users/profile', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute('''
        UPDATE users SET full_name = \$2, email = \$3, phone = \$4, address = \$5, city = \$6, region = \$7, updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [
        userId, data['fullName'], data['email'], data['phone'],
        data['address'], data['city'], data['region']
      ]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Profil mis à jour'}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/users/pin', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      final checkResult = await db.connection.execute(
        'SELECT pin FROM users WHERE id = \$1 AND pin = \$2',
        parameters: [userId, data['currentPin']],
      );
      
      if (checkResult.isEmpty) {
        return Response.forbidden(jsonEncode({'success': false, 'message': 'PIN actuel incorrect'}));
      }
      
      await db.connection.execute(
        'UPDATE users SET pin = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [userId, data['newPin']],
      );
      
      return Response.ok(jsonEncode({'success': true, 'message': 'PIN mis à jour avec succès'}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // ==================== ROUTES COLIS ====================
  
  router.post('/parcels/create', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    }
    
    try {
      final body = await request.readAsString();
      print('📦 Body reçu: $body');
      final data = jsonDecode(body);
      
      final parcelId = _uuid.v4();
      final trackingNumber = 'PC-${DateTime.now().year}${DateTime.now().month.toString().padLeft(2, '0')}${DateTime.now().day.toString().padLeft(2, '0')}-${_uuid.v4().substring(0, 6).toUpperCase()}';
      
      final senderResult = await db.connection.execute(
        'SELECT full_name, phone FROM users WHERE id = \$1',
        parameters: [userId],
      );
      
      final senderName = senderResult.first[0] as String;
      final senderPhone = senderResult.first[1] as String;
      
      await db.connection.execute('''
        INSERT INTO parcels (id, tracking_number, sender_id, sender_name, sender_phone, receiver_name, receiver_phone, 
                             receiver_email, description, weight, type, status, departure_garage_id, departure_garage_name,
                             arrival_garage_id, arrival_garage_name, price, created_at, updated_at)
        VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, \$14, \$15, \$16, \$17, NOW(), NOW())
      ''', parameters: [
        parcelId, trackingNumber, userId, senderName, senderPhone,
        data['receiverName'], data['receiverPhone'], data['receiverEmail'] ?? null,
        data['description'], data['weight'], data['type'] ?? 'package', 'pending',
        data['departureGarageId'], data['departureGarageName'],
        data['arrivalGarageId'], data['arrivalGarageName'], data['price'] ?? null
      ]);
      
      print('✅ Colis créé: $trackingNumber');
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Colis créé avec succès',
        'parcel': {'id': parcelId, 'trackingNumber': trackingNumber}
      }));
    } catch (e) {
      print('❌ Erreur création colis: $e');
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/parcels/my-parcels', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    }
    
    try {
      final result = await db.connection.execute('''
        SELECT id, tracking_number, receiver_name, status, weight, price, created_at
        FROM parcels WHERE sender_id = \$1 ORDER BY created_at DESC
      ''', parameters: [userId]);
      
      final parcels = result.map((row) => {
        'id': row[0],
        'trackingNumber': row[1],
        'receiverName': row[2],
        'status': row[3],
        'weight': row[4],
        'price': row[5],
        'createdAt': (row[6] as DateTime).toIso8601String(),
      }).toList();
      
      return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/parcels/track/<tracking>', (Request request, String tracking) async {
    try {
      final result = await db.connection.execute('''
        SELECT id, tracking_number, sender_name, receiver_name, receiver_phone, status, description, weight, price, created_at
        FROM parcels WHERE tracking_number = \$1
      ''', parameters: [tracking]);
      
      if (result.isEmpty) {
        return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
      }
      
      final parcel = {
        'id': result.first[0],
        'trackingNumber': result.first[1],
        'senderName': result.first[2],
        'receiverName': result.first[3],
        'receiverPhone': result.first[4],
        'status': result.first[5],
        'description': result.first[6],
        'weight': result.first[7],
        'price': result.first[8],
        'createdAt': (result.first[9] as DateTime).toIso8601String(),
      };
      
      return Response.ok(jsonEncode({'success': true, 'parcel': parcel}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/parcels/<id>', (Request request, String id) async {
    try {
      final result = await db.connection.execute('SELECT * FROM parcels WHERE id = \$1', parameters: [id]);
      
      if (result.isEmpty) {
        return Response.notFound(jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
      }
      
      final row = result.first;
      final parcel = {
        'id': row[0], 'trackingNumber': row[1], 'senderName': row[3], 'senderPhone': row[4],
        'receiverName': row[5], 'receiverPhone': row[6], 'receiverEmail': row[7],
        'description': row[8], 'weight': row[9], 'type': row[10], 'status': row[11],
        'departureGarageName': row[13], 'arrivalGarageName': row[15],
        'driverName': row[17], 'driverPhone': row[18], 'price': row[19],
        'createdAt': (row[26] as DateTime).toIso8601String(),
      };
      
      return Response.ok(jsonEncode({'success': true, 'parcel': parcel}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/parcels/<id>/cancel', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    }
    
    try {
      await db.connection.execute(
        'UPDATE parcels SET status = \'cancelled\', updated_at = NOW() WHERE id = \$1 AND sender_id = \$2',
        parameters: [id, userId],
      );
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Colis annulé'}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // ==================== ROUTES CHAUFFEURS ====================
  
  router.get('/driver/parcels', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isDriver(userId)) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès réservé aux chauffeurs'}));
    }
    
    try {
      final result = await db.connection.execute('''
        SELECT id, tracking_number, sender_name, receiver_name, receiver_phone, status, description, departure_garage_name, arrival_garage_name, created_at
        FROM parcels WHERE driver_id = \$1 ORDER BY created_at DESC
      ''', parameters: [userId]);
      
      final parcels = result.map((row) => {
        'id': row[0], 'trackingNumber': row[1], 'senderName': row[2],
        'receiverName': row[3], 'receiverPhone': row[4], 'status': row[5],
        'description': row[6], 'departureGarageName': row[7], 'arrivalGarageName': row[8],
        'createdAt': (row[9] as DateTime).toIso8601String(),
      }).toList();
      
      return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/driver/parcels/<id>/pickup', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    
    try {
      await db.connection.execute(
        'UPDATE parcels SET status = \'picked_up\', updated_at = NOW() WHERE id = \$1 AND driver_id = \$2',
        parameters: [id, userId],
      );
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Ramassage confirmé'}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/driver/parcels/<id>/deliver', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute('''
        UPDATE parcels SET status = \'delivered\', signature_url = \$3, delivery_date = NOW(), updated_at = NOW()
        WHERE id = \$1 AND driver_id = \$2
      ''', parameters: [id, userId, data['signature']]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Livraison confirmée'}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/driver/status', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null) return Response.forbidden(jsonEncode({'success': false, 'message': 'Non authentifié'}));
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute(
        'UPDATE users SET driver_status = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [userId, data['status']],
      );
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Statut mis à jour'}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // ==================== ROUTES ADMIN GARAGE ====================
  
  router.get('/admin/garage/parcels', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isAdmin(userId)) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final garageResult = await db.connection.execute(
        'SELECT garage_id FROM users WHERE id = \$1',
        parameters: [userId],
      );
      final garageId = garageResult.first[0];
      
      final result = await db.connection.execute('''
        SELECT id, tracking_number, sender_name, receiver_name, status, driver_name, created_at
        FROM parcels WHERE departure_garage_id = \$1 OR arrival_garage_id = \$1
        ORDER BY created_at DESC
      ''', parameters: [garageId]);
      
      final parcels = result.map((row) => {
        'id': row[0], 'trackingNumber': row[1], 'senderName': row[2],
        'receiverName': row[3], 'status': row[4], 'driverName': row[5],
        'createdAt': (row[6] as DateTime).toIso8601String(),
      }).toList();
      
      return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/admin/garage/drivers', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isAdmin(userId)) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final garageResult = await db.connection.execute(
        'SELECT garage_id FROM users WHERE id = \$1',
        parameters: [userId],
      );
      final garageId = garageResult.first[0];
      
      final result = await db.connection.execute('''
        SELECT id, full_name, email, phone, driver_status, vehicle_plate, vehicle_model
        FROM users WHERE role = 'driver' AND garage_id = \$1
      ''', parameters: [garageId]);
      
      final drivers = result.map((row) => ({
        'id': row[0], 'fullName': row[1], 'email': row[2], 'phone': row[3],
        'driverStatus': row[4], 'vehiclePlate': row[5], 'vehicleModel': row[6],
      })).toList();
      
      return Response.ok(jsonEncode({'success': true, 'drivers': drivers}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/admin/garage/parcels/<id>/assign-driver', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isAdmin(userId)) {
      return Response.forbidden(jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      final driverResult = await db.connection.execute(
        'SELECT full_name, phone FROM users WHERE id = \$1',
        parameters: [data['driverId']],
      );
      
      await db.connection.execute('''
        UPDATE parcels SET driver_id = \$2, driver_name = \$3, driver_phone = \$4, status = 'confirmed', updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [id, data['driverId'], driverResult.first[0], driverResult.first[1]]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Chauffeur assigné'}));
    } catch (e) {
      return Response.internalServerError(body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // ==================== ROUTES SUPER ADMIN ====================
  
  // Statistiques globales
  router.get('/super-admin/stats', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final userCount = await db.connection.execute('SELECT COUNT(*) FROM users');
      final driverCount = await db.connection.execute('SELECT COUNT(*) FROM users WHERE role = \'driver\'');
      final garageCount = await db.connection.execute('SELECT COUNT(*) FROM garages');
      final parcelCount = await db.connection.execute('SELECT COUNT(*) FROM parcels');
      final deliveredCount = await db.connection.execute('SELECT COUNT(*) FROM parcels WHERE status = \'delivered\'');
      final revenueResult = await db.connection.execute('SELECT COALESCE(SUM(price), 0) FROM parcels WHERE status = \'delivered\'');
      
      return Response.ok(jsonEncode({
        'success': true,
        'stats': {
          'totalUsers': userCount.first[0],
          'totalDrivers': driverCount.first[0],
          'totalGarages': garageCount.first[0],
          'totalParcels': parcelCount.first[0],
          'deliveredParcels': deliveredCount.first[0],
          'totalRevenue': revenueResult.first[0],
        }
      }));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // GESTION DES UTILISATEURS
  router.get('/super-admin/users', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final result = await db.connection.execute('''
        SELECT id, email, phone, full_name, role, status, address, city, region, 
               vehicle_plate, vehicle_model, driver_status, garage_id, created_at
        FROM users ORDER BY created_at DESC
      ''');
      
      final users = result.map((row) => ({
        'id': row[0], 'email': row[1], 'phone': row[2], 'fullName': row[3],
        'role': row[4], 'status': row[5], 'address': row[6], 'city': row[7],
        'region': row[8], 'vehiclePlate': row[9], 'vehicleModel': row[10],
        'driverStatus': row[11], 'garageId': row[12],
        'createdAt': (row[13] as DateTime).toIso8601String(),
      })).toList();
      
      return Response.ok(jsonEncode({'success': true, 'users': users}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/super-admin/users/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final result = await db.connection.execute('''
        SELECT id, email, phone, full_name, role, status, address, city, region, 
               vehicle_plate, vehicle_model, driver_status, garage_id, created_at, updated_at
        FROM users WHERE id = \$1
      ''', parameters: [id]);
      
      if (result.isEmpty) {
        return Response(404, body: jsonEncode({'success': false, 'message': 'Utilisateur non trouvé'}));
      }
      
      final row = result.first;
      final user = {
        'id': row[0], 'email': row[1], 'phone': row[2], 'fullName': row[3],
        'role': row[4], 'status': row[5], 'address': row[6], 'city': row[7],
        'region': row[8], 'vehiclePlate': row[9], 'vehicleModel': row[10],
        'driverStatus': row[11], 'garageId': row[12],
        'createdAt': (row[13] as DateTime).toIso8601String(),
        'updatedAt': row[14] != null ? (row[14] as DateTime).toIso8601String() : null,
      };
      
      return Response.ok(jsonEncode({'success': true, 'user': user}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.post('/super-admin/users', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      final newUserId = _uuid.v4();
      
      await db.connection.execute('''
        INSERT INTO users (id, email, phone, full_name, role, status, pin, address, city, region, 
                           vehicle_plate, vehicle_model, driver_status, garage_id, created_at, updated_at)
        VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, \$14, NOW(), NOW())
      ''', parameters: [
        newUserId, data['email'], data['phone'], data['fullName'],
        data['role'] ?? 'client', data['status'] ?? 'active', data['pin'] ?? '123456',
        data['address'], data['city'], data['region'],
        data['vehiclePlate'], data['vehicleModel'], data['driverStatus'], data['garageId']
      ]);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Utilisateur créé avec succès',
        'userId': newUserId
      }));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/super-admin/users/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute('''
        UPDATE users SET 
          full_name = \$2, email = \$3, phone = \$4, role = \$5, status = \$6,
          address = \$7, city = \$8, region = \$9, vehicle_plate = \$10, 
          vehicle_model = \$11, driver_status = \$12, garage_id = \$13, updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [
        id, data['fullName'], data['email'], data['phone'], data['role'], data['status'],
        data['address'], data['city'], data['region'], data['vehiclePlate'],
        data['vehicleModel'], data['driverStatus'], data['garageId']
      ]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Utilisateur mis à jour'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.patch('/super-admin/users/<id>/role', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute(
        'UPDATE users SET role = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [id, data['role']],
      );
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Rôle mis à jour'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.patch('/super-admin/users/<id>/status', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute(
        'UPDATE users SET status = \$2, updated_at = NOW() WHERE id = \$1',
        parameters: [id, data['status']],
      );
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Statut mis à jour'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.delete('/super-admin/users/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      if (userId == id) {
        return Response(400, body: jsonEncode({'success': false, 'message': 'Vous ne pouvez pas supprimer votre propre compte'}));
      }
      
      await db.connection.execute('DELETE FROM users WHERE id = \$1', parameters: [id]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Utilisateur supprimé'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // GESTION DES GARAGES
  router.get('/super-admin/garages', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final result = await db.connection.execute('''
        SELECT id, name, city, region, address, phone, latitude, longitude, 
               drivers_count, parcels_count, revenue, created_at, updated_at
        FROM garages ORDER BY created_at DESC
      ''');
      
      final garages = result.map((row) => ({
        'id': row[0], 'name': row[1], 'city': row[2], 'region': row[3],
        'address': row[4], 'phone': row[5], 'latitude': row[6], 'longitude': row[7],
        'driversCount': row[8], 'parcelsCount': row[9], 'revenue': row[10],
        'createdAt': (row[11] as DateTime).toIso8601String(),
        'updatedAt': (row[12] as DateTime).toIso8601String(),
      })).toList();
      
      return Response.ok(jsonEncode({'success': true, 'garages': garages}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/super-admin/garages/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final result = await db.connection.execute('SELECT * FROM garages WHERE id = \$1', parameters: [id]);
      
      if (result.isEmpty) {
        return Response(404, body: jsonEncode({'success': false, 'message': 'Garage non trouvé'}));
      }
      
      final row = result.first;
      final garage = {
        'id': row[0], 'name': row[1], 'city': row[2], 'region': row[3],
        'address': row[4], 'phone': row[5], 'latitude': row[6], 'longitude': row[7],
        'driversCount': row[8], 'parcelsCount': row[9], 'revenue': row[10],
        'createdAt': (row[11] as DateTime).toIso8601String(),
        'updatedAt': (row[12] as DateTime).toIso8601String(),
      };
      
      return Response.ok(jsonEncode({'success': true, 'garage': garage}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.post('/super-admin/garages', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      final garageId = _uuid.v4();
      
      await db.connection.execute('''
        INSERT INTO garages (id, name, city, region, address, phone, latitude, longitude, created_at, updated_at)
        VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, NOW(), NOW())
      ''', parameters: [
        garageId, data['name'], data['city'], data['region'],
        data['address'], data['phone'], data['latitude'], data['longitude']
      ]);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Garage créé avec succès',
        'garageId': garageId
      }));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/super-admin/garages/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute('''
        UPDATE garages SET 
          name = \$2, city = \$3, region = \$4, address = \$5, phone = \$6,
          latitude = \$7, longitude = \$8, updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [
        id, data['name'], data['city'], data['region'],
        data['address'], data['phone'], data['latitude'], data['longitude']
      ]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Garage mis à jour'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.delete('/super-admin/garages/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      await db.connection.execute('DELETE FROM garages WHERE id = \$1', parameters: [id]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Garage supprimé'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // GESTION DES COLIS
  router.get('/super-admin/parcels', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final result = await db.connection.execute('''
        SELECT id, tracking_number, sender_name, receiver_name, status, price, created_at
        FROM parcels ORDER BY created_at DESC
      ''');
      
      final parcels = result.map((row) => ({
        'id': row[0], 'trackingNumber': row[1], 'senderName': row[2],
        'receiverName': row[3], 'status': row[4], 'price': row[5],
        'createdAt': (row[6] as DateTime).toIso8601String(),
      })).toList();
      
      return Response.ok(jsonEncode({'success': true, 'parcels': parcels}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/super-admin/parcels/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final result = await db.connection.execute('SELECT * FROM parcels WHERE id = \$1', parameters: [id]);
      
      if (result.isEmpty) {
        return Response(404, body: jsonEncode({'success': false, 'message': 'Colis non trouvé'}));
      }
      
      final row = result.first;
      final parcel = {
        'id': row[0], 'trackingNumber': row[1], 'senderName': row[3],
        'receiverName': row[5], 'status': row[11], 'price': row[19],
        'createdAt': (row[26] as DateTime).toIso8601String(),
      };
      
      return Response.ok(jsonEncode({'success': true, 'parcel': parcel}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.put('/super-admin/parcels/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      await db.connection.execute('''
        UPDATE parcels SET status = \$2, price = \$3, driver_id = \$4, updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [id, data['status'], data['price'], data['driverId']]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Colis mis à jour'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.delete('/super-admin/parcels/<id>', (Request request, String id) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      await db.connection.execute('DELETE FROM parcels WHERE id = \$1', parameters: [id]);
      
      return Response.ok(jsonEncode({'success': true, 'message': 'Colis supprimé'}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // GESTION DES ADMINS GARAGE
  router.post('/super-admin/garage-admins', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final body = await request.readAsString();
      final data = jsonDecode(body);
      
      final adminId = _uuid.v4();
      
      await db.connection.execute('''
        INSERT INTO users (id, email, phone, full_name, role, pin, garage_id, created_at, updated_at)
        VALUES (\$1, \$2, \$3, \$4, 'admin', \$5, \$6, NOW(), NOW())
      ''', parameters: [adminId, data['email'], data['phone'], data['fullName'], data['pin'] ?? '123456', data['garageId']]);
      
      return Response.ok(jsonEncode({
        'success': true,
        'message': 'Admin garage créé avec succès',
        'adminId': adminId
      }));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  router.get('/super-admin/garage-admins', (Request request) async {
    final userId = extractUserIdFromToken(request);
    if (userId == null || !await isSuperAdmin(userId)) {
      return Response(403, body: jsonEncode({'success': false, 'message': 'Accès non autorisé'}));
    }
    
    try {
      final result = await db.connection.execute('''
        SELECT id, email, phone, full_name, garage_id, status, created_at
        FROM users WHERE role = 'admin' ORDER BY created_at DESC
      ''');
      
      final admins = result.map((row) => ({
        'id': row[0], 'email': row[1], 'phone': row[2], 'fullName': row[3],
        'garageId': row[4], 'status': row[5],
        'createdAt': (row[6] as DateTime).toIso8601String(),
      })).toList();
      
      return Response.ok(jsonEncode({'success': true, 'admins': admins}));
    } catch (e) {
      return Response(500, body: jsonEncode({'success': false, 'message': e.toString()}));
    }
  });

  // ==================== MIDDLEWARE ====================
  
  final handler = const Pipeline()
      .addMiddleware(logRequests())
      .addMiddleware(corsMiddleware())
      .addHandler(router.call);

  final port = int.parse(env['PORT'] ?? '8080');
  final server = await serve(handler, '0.0.0.0', port);
  
  print('');
  print('╔════════════════════════════════════════════════════════════════════╗');
  print('║                         PRO COLIS BACKEND                          ║');
  print('╠════════════════════════════════════════════════════════════════════╣');
  print('║ 🚀 Serveur démarré sur: http://localhost:${server.port}           ║');
  print('║ 🗄️  Base de données PostgreSQL connectée                          ║');
  print('║ 🌐 CORS activé pour toutes les origines                           ║');
  print('╠════════════════════════════════════════════════════════════════════╣');
  print('║ 📋 Routes par rôle:                                                ║');
  print('║    👤 CLIENT: /parcels/create, /parcels/my-parcels, /parcels/track');
  print('║    🚚 CHAUFFEUR: /driver/parcels, /driver/parcels/*/pickup, /driver/parcels/*/deliver');
  print('║    🏢 ADMIN GARAGE: /admin/garage/parcels, /admin/garage/drivers');
  print('║    👑 SUPER ADMIN: /super-admin/stats, /super-admin/users, /super-admin/garages, /super-admin/parcels');
  print('╚════════════════════════════════════════════════════════════════════╝');
  print('');
}