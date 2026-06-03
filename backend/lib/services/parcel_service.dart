// backend/lib/services/parcel_service.dart
import 'dart:async';
import 'dart:convert';

import 'package:procolis_backend/services/database_service.dart';
import 'package:procolis_backend/services/email_service.dart';
import 'package:uuid/uuid.dart';

class ParcelService {
  final _uuid = const Uuid();
  final EmailService _emailService;

  ParcelService({required EmailService emailService})
      : _emailService = emailService;

  // ==================== GÉNÉRATION ====================

  String _generateTrackingNumber() {
    final now = DateTime.now();
    final year = now.year;
    final month = now.month.toString().padLeft(2, '0');
    final day = now.day.toString().padLeft(2, '0');
    final random = _uuid.v4().substring(0, 6).toUpperCase();
    return 'COL-$year$month$day-$random';
  }

  String _getStatusDescription(String status) {
    switch (status) {
      case 'pending':
        return 'Colis créé';
      case 'confirmed':
        return 'Colis confirmé';
      case 'picked_up':
        return 'Colis ramassé';
      case 'in_transit':
        return 'Colis en transit';
      case 'arrived':
        return 'Colis arrivé au garage';
      case 'out_for_delivery':
        return 'Colis en livraison';
      case 'delivered':
        return 'Colis livré';
      case 'cancelled':
        return 'Colis annulé';
      default:
        return 'Statut mis à jour';
    }
  }

  String _getStatusLabel(String status) {
    switch (status) {
      case 'pending':
        return 'En attente';
      case 'confirmed':
        return 'Confirmé';
      case 'picked_up':
        return 'Ramasse';
      case 'in_transit':
        return 'En transit';
      case 'arrived':
        return 'Arrivé au garage';
      case 'out_for_delivery':
        return 'En cours de livraison';
      case 'delivered':
        return 'Livré avec succès';
      case 'cancelled':
        return 'Annulé';
      default:
        return 'Mise à jour';
    }
  }

  // ==================== NOTIFICATIONS EMAIL ====================

  Future<void> _sendParcelNotification({
    required String toEmail,
    required String toPhone,
    required String trackingNumber,
    required String status,
    required String statusLabel,
    required String receiverName,
    String? location,
    String? senderName,
  }) async {
    if (toEmail.isEmpty) return;

    final subject = '📦 PRO COLIS - Mise à jour de votre colis';

    final htmlBody = '''
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mise à jour colis PRO COLIS</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 20px auto; padding: 0; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #0B6E3A 0%, #0a5a2f 100%); padding: 30px 20px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 28px; letter-spacing: 1px; }
        .content { padding: 30px; background: #ffffff; }
        .status { display: inline-block; background: #0B6E3A; color: white; padding: 8px 20px; border-radius: 20px; font-weight: bold; margin: 10px 0; }
        .tracking { font-size: 24px; font-weight: bold; color: #0B6E3A; margin: 10px 0; }
        .info { background: #f0f9f0; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .button { display: inline-block; background: #0B6E3A; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin-top: 20px; font-weight: bold; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #888; background: #f9f9f9; border-top: 1px solid #eee; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>PRO COLIS</h1>
        </div>
        <div class="content">
          <h2 style="color: #0B6E3A; margin-top: 0;">Mise à jour de votre colis</h2>
          <p>Bonjour,</p>
          <p>Le statut de votre colis a été mis à jour.</p>
          <div class="tracking">📦 $trackingNumber</div>
          <div class="info">
            <p><strong>📊 Nouveau statut :</strong></p>
            <div class="status">$statusLabel</div>
            <p><strong>👤 Destinataire :</strong> $receiverName</p>
            ${senderName != null ? '<p><strong>👤 Expéditeur :</strong> $senderName</p>' : ''}
            ${location != null ? '<p><strong>📍 Lieu :</strong> $location</p>' : ''}
          </div>
          <p style="text-align: center;">
            <a href="https://procolis.sn/track/$trackingNumber" class="button">🔍 Suivre mon colis</a>
          </p>
          <p>Merci d'avoir choisi PRO COLIS pour votre transport !</p>
        </div>
        <div class="footer">
          <p>PRO COLIS - Service de transport interurbain</p>
          <p>📞 Contactez-nous au +221 33 123 45 67</p>
        </div>
      </div>
    </body>
    </html>
    ''';

    final textBody = '''
PRO COLIS - Mise à jour de votre colis $trackingNumber

Nouveau statut : $statusLabel
Destinataire : $receiverName
${location != null ? 'Lieu : $location' : ''}

Suivez votre colis : https://procolis.sn/track/$trackingNumber

Merci d'avoir choisi PRO COLIS !
''';

    await _emailService.sendEmail(
      to: toEmail,
      subject: subject,
      htmlBody: htmlBody,
      textBody: textBody,
    );
  }

  // ==================== VÉRIFICATION DES COLONNES ====================

  Future<Map<String, bool>> _checkColumns() async {
    final db = await DatabaseService.getInstance();
    final columns = {
      'total_amount': false,
      'delivery_fees': false,
      'urgent_fee': false,
      'insurance_amount': false,
      'video_urls': false,
      'estimated_delivery_date': false,
      'cancelled_by': false,
      'cancellation_reason': false,
      'cancelled_at': false,
      'notes': false,
      'length': false,
      'width': false,
      'height': false,
      'payment_phone_number': false,
    };

    try {
      final result = await db.connection.execute('''
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'parcels'
      ''');

      for (final row in result) {
        final colName = row[0].toString();
        if (columns.containsKey(colName)) {
          columns[colName] = true;
        }
      }
    } catch (e) {
      print('⚠️ Erreur vérification colonnes: $e');
    }

    return columns;
  }

  // ==================== CRÉATION ====================

  Future<Map<String, dynamic>> createParcel(
    String userId, Map<String, dynamic> data) async {
  final db = await DatabaseService.getInstance();
  final parcelId = _uuid.v4();
  final trackingNumber = _generateTrackingNumber();

  print('📝 Insertion colis:');
  print('  - trackingNumber: $trackingNumber');
  print('  - price: ${data['price']}');
  print('  - totalAmount: ${data['totalAmount']}');

  // Récupérer les infos de l'utilisateur
  final userResult = await db.connection.execute(
    'SELECT full_name, phone, email, role FROM users WHERE id = \$1',
    parameters: [userId],
  );

  final currentUserName = userResult.first[0].toString();
  final currentUserPhone = userResult.first[1].toString();
  final userRole = userResult.first[3].toString();
  final isDriver = userRole == 'driver';
  final initialStatus = isDriver ? 'confirmed' : 'pending';

  // Auto-assignation du chauffeur
  final driverId = isDriver ? userId : data['driverId']?.toString();
  final driverName = isDriver ? currentUserName : data['driverName']?.toString();
  final driverPhone = isDriver ? currentUserPhone : data['driverPhone']?.toString();

  // Données
  final senderName = data['senderName']?.toString();
  final senderPhone = data['senderPhone']?.toString();
  final senderEmail = data['senderEmail']?.toString();
  final String? senderId = data['senderId'] != null && data['senderId'].toString().isNotEmpty
      ? data['senderId'].toString()
      : null;

  final receiverName = data['receiverName']?.toString();
  final receiverPhone = data['receiverPhone']?.toString();
  final receiverEmail = data['receiverEmail']?.toString();
  final receiverAddress = data['receiverAddress']?.toString();

  final arrivalGarageId = data['arrivalGarageId']?.toString();
  final arrivalGarageName = data['arrivalGarageName']?.toString();
  final notes = data['notes']?.toString();
  final pickupDate = data['pickupDate']?.toString();
  final estimatedDeliveryDate = data['estimatedDeliveryDate']?.toString();

  // Médias - Convertir en format PostgreSQL ARRAY
  final List<String> photoUrls = data['photoUrls'] != null
      ? List<String>.from(data['photoUrls'])
      : [];
  final List<String> videoUrls = data['videoUrls'] != null
      ? List<String>.from(data['videoUrls'])
      : [];

  // Fonction pour convertir List en PostgreSQL ARRAY
  String listToPgArray(List<String> list) {
    if (list.isEmpty) return '{}';
    // Échapper les guillemets dans les URLs
    final escaped = list.map((url) => url.replaceAll('"', '\\"')).toList();
    return '{${escaped.join(',')}}';
  }

  final String photoUrlsPg = listToPgArray(photoUrls);
  final String videoUrlsPg = listToPgArray(videoUrls);

  print('📸 Photos reçues: $photoUrls');
  print('🎬 Vidéos reçues: $videoUrls');
  print('📸 Photos PG: $photoUrlsPg');
  print('🎬 Vidéos PG: $videoUrlsPg');

  // Options
  final isInsured = data['isInsured'] == true;
  final isUrgent = data['isUrgent'] == true;
  final price = data['price'] != null ? (data['price'] as num).toDouble() : 0;
  final deliveryFees = data['deliveryFees'] != null ? (data['deliveryFees'] as num).toDouble() : 0;
  final totalAmount = data['totalAmount'] != null
      ? (data['totalAmount'] as num).toDouble()
      : price + deliveryFees;

  final paymentMethod = data['paymentMethod']?.toString();
  final paymentPhoneNumber = data['paymentPhoneNumber']?.toString();
  final paymentStatus = 'pending';

  // Construction de la requête
  final columns = <String>[];
  final values = <dynamic>[];

  // Colonnes de base
  final baseColumns = {
    'id': parcelId,
    'tracking_number': trackingNumber,
    'sender_id': senderId,
    'sender_name': senderName,
    'sender_phone': senderPhone,
    'sender_email': senderEmail,
    'receiver_name': receiverName,
    'receiver_phone': receiverPhone,
    'receiver_email': receiverEmail,
    'receiver_address': receiverAddress,
    'description': data['description']?.toString() ?? '',
    'weight': (data['weight'] as num).toDouble(),
    'type': data['type']?.toString() ?? 'package',
    'status': initialStatus,
    'departure_garage_id': data['departureGarageId']?.toString(),
    'departure_garage_name': data['departureGarageName']?.toString(),
    'arrival_garage_id': arrivalGarageId,
    'arrival_garage_name': arrivalGarageName,
    'driver_id': driverId,
    'driver_name': driverName,
    'driver_phone': driverPhone,
    'price': price,
    'is_urgent': isUrgent,
    'is_insured': isInsured,
    'payment_method': paymentMethod,
    'payment_status': paymentStatus,
    'photo_urls': photoUrlsPg,
    'created_by': userId,
    'created_at': DateTime.now(),
    'updated_at': DateTime.now(),
  };

  for (final entry in baseColumns.entries) {
    columns.add(entry.key);
    values.add(entry.value);
  }

  // Ajouter video_urls
  columns.add('video_urls');
  values.add(videoUrlsPg);
  print('📹 Ajout de video_urls: $videoUrlsPg');

  // Colonnes optionnelles
  if (notes != null && notes.isNotEmpty) {
    columns.add('notes');
    values.add(notes);
  }
  if (pickupDate != null) {
    columns.add('pickup_date');
    values.add(DateTime.tryParse(pickupDate));
  }
  if (estimatedDeliveryDate != null) {
    columns.add('estimated_delivery_date');
    values.add(DateTime.tryParse(estimatedDeliveryDate));
  }
  if (paymentPhoneNumber != null && paymentPhoneNumber.isNotEmpty) {
    columns.add('payment_phone_number');
    values.add(paymentPhoneNumber);
  }
  if (totalAmount != null) {
    columns.add('total_amount');
    values.add(totalAmount);
  }
  if (deliveryFees != null) {
    columns.add('delivery_fees');
    values.add(deliveryFees);
  }

  final placeholders = List.generate(values.length, (i) => '\$${i + 1}').join(', ');
  final sql = 'INSERT INTO parcels (${columns.join(', ')}) VALUES ($placeholders)';

  print('📝 SQL: $sql');
  print('📝 Nombre de valeurs: ${values.length}');

  try {
    await db.connection.execute(sql, parameters: values);
    print('✅ Insertion réussie');

    // Événement de création
    await createParcelEvent(
      parcelId,
      initialStatus,
      'Colis créé par $currentUserName',
      userId: userId,
      userName: currentUserName,
      metadata: {
        'type': 'creation',
        'weight': data['weight'],
        'trackingNumber': trackingNumber,
        'clientName': senderName,
        'totalAmount': totalAmount,
        'photoCount': photoUrls.length,
        'videoCount': videoUrls.length,
      },
    );

    // Événement de confirmation pour les chauffeurs
    if (isDriver) {
      await createParcelEvent(
        parcelId,
        'confirmed',
        'Colis confirmé et prêt pour le transport',
        userId: userId,
        userName: currentUserName,
        metadata: {
          'type': 'confirmation',
          'driverId': driverId,
          'driverName': driverName,
        },
      );
    }

    return {
      'success': true,
      'id': parcelId,
      'trackingNumber': trackingNumber,
      'status': initialStatus,
      'createdAt': DateTime.now().toIso8601String(),
      'driverId': driverId,
      'driverName': driverName,
      'senderName': senderName,
      'totalAmount': totalAmount,
    };
  } catch (e) {
    print('❌ Erreur insertion colis: $e');
    return {'success': false, 'error': e.toString()};
  }
}

  // ==================== LECTURE ====================

  Future<List<Map<String, dynamic>>> getUserParcels(String userId,
      {String? status}) async {
    final db = await DatabaseService.getInstance();

    try {
      var query = '''
        SELECT 
          id, tracking_number, sender_name, sender_phone,
          receiver_name, receiver_phone,
          description, weight, type, status,
          price, total_amount, payment_status,
          departure_garage_name, arrival_garage_name,
          driver_name, driver_phone,
          pickup_date, delivery_date, created_at, updated_at
        FROM parcels WHERE sender_id = \$1
      ''';
      final params = [userId];

      if (status != null && status.isNotEmpty) {
        query += ' AND status = \$2';
        params.add(status);
      }

      query += ' ORDER BY created_at DESC';

      final result = await db.connection.execute(query, parameters: params);

      return result
          .map((row) => ({
                'id': row[0],
                'trackingNumber': row[1],
                'senderName': row[2],
                'senderPhone': row[3],
                'receiverName': row[4],
                'receiverPhone': row[5],
                'description': row[6],
                'weight': row[7],
                'type': row[8],
                'status': row[9],
                'price': row[10],
                'totalAmount': row[11],
                'paymentStatus': row[12],
                'departureGarageName': row[13],
                'arrivalGarageName': row[14],
                'driverName': row[15],
                'driverPhone': row[16],
                'pickupDate': row[17] != null
                    ? (row[17] as DateTime).toIso8601String()
                    : null,
                'deliveryDate': row[18] != null
                    ? (row[18] as DateTime).toIso8601String()
                    : null,
                'createdAt': (row[19] as DateTime).toIso8601String(),
                'updatedAt': row[20] != null
                    ? (row[20] as DateTime).toIso8601String()
                    : null,
              }))
          .toList();
    } catch (e) {
      print('❌ Erreur getUserParcels: $e');
      return [];
    }
  }

  Future<Map<String, dynamic>?> getParcelById(String parcelId) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute('''
        SELECT 
          id, tracking_number,
          sender_id, sender_name, sender_phone, sender_email,
          receiver_name, receiver_phone, receiver_email, receiver_address,
          description, weight, length, width, height, type, status,
          departure_garage_id, departure_garage_name,
          arrival_garage_id, arrival_garage_name,
          driver_id, driver_name, driver_phone,
          price, is_urgent, is_insured,
          payment_method, payment_phone_number, payment_status,
          total_amount, delivery_fees,
          photo_urls, video_urls, signature_url,
          notes, pickup_date, delivery_date, estimated_delivery_date,
          created_by, created_at, updated_at,
          cancelled_by, cancellation_reason, cancelled_at
        FROM parcels WHERE id = \$1
      ''', parameters: [parcelId]);

      if (result.isEmpty) return null;

      final row = result.first;

      double? toDouble(dynamic value) {
        if (value == null) return null;
        if (value is double) return value;
        if (value is int) return value.toDouble();
        if (value is String && value.isNotEmpty) return double.tryParse(value);
        return null;
      }

      bool toBool(dynamic value) {
        if (value == null) return false;
        if (value is bool) return value;
        if (value is String) return value.toLowerCase() == 'true';
        return false;
      }

      List<String> toList(dynamic value) {
        if (value == null) return [];
        if (value is List) return value.map((e) => e.toString()).toList();
        if (value is String && value.isNotEmpty && value != '[]') {
          try {
            final decoded = jsonDecode(value);
            if (decoded is List) return decoded.map((e) => e.toString()).toList();
          } catch (e) {}
        }
        return [];
      }

      final events = await getParcelEvents(parcelId);

      return {
        'id': row[0],
        'trackingNumber': row[1],
        'senderId': row[2],
        'senderName': row[3],
        'senderPhone': row[4],
        'senderEmail': row[5],
        'receiverName': row[6],
        'receiverPhone': row[7],
        'receiverEmail': row[8],
        'receiverAddress': row[9],
        'description': row[10],
        'weight': toDouble(row[11]),
        'length': toDouble(row[12]),
        'width': toDouble(row[13]),
        'height': toDouble(row[14]),
        'type': row[15],
        'status': row[16],
        'departureGarageId': row[17],
        'departureGarageName': row[18],
        'arrivalGarageId': row[19],
        'arrivalGarageName': row[20],
        'driverId': row[21],
        'driverName': row[22],
        'driverPhone': row[23],
        'price': toDouble(row[24]),
        'isUrgent': toBool(row[25]),
        'isInsured': toBool(row[26]),
        'paymentMethod': row[27],
        'paymentPhoneNumber': row[28],
        'paymentStatus': row[29],
        'totalAmount': toDouble(row[30]),
        'deliveryFees': toDouble(row[31]),
        'photoUrls': toList(row[32]),
        'videoUrls': toList(row[33]),
        'signatureUrl': row[34],
        'notes': row[35],
        'pickupDate': row[36] != null ? (row[36] as DateTime).toIso8601String() : null,
        'deliveryDate': row[37] != null ? (row[37] as DateTime).toIso8601String() : null,
        'estimatedDeliveryDate': row[38] != null ? (row[38] as DateTime).toIso8601String() : null,
        'createdBy': row[39],
        'createdAt': (row[40] as DateTime).toIso8601String(),
        'updatedAt': row[41] != null ? (row[41] as DateTime).toIso8601String() : null,
        'cancelledBy': row[42],
        'cancellationReason': row[43],
        'cancelledAt': row[44] != null ? (row[44] as DateTime).toIso8601String() : null,
        'events': events,
      };
    } catch (e) {
      print('❌ Erreur getParcelById: $e');
      return null;
    }
  }

  Future<List<Map<String, dynamic>>> getDriverParcels(String driverId) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute('''
        SELECT 
          id, tracking_number, sender_name, sender_phone,
          receiver_name, receiver_phone,
          description, weight, type, status,
          departure_garage_name, arrival_garage_name,
          price, total_amount, payment_method, payment_status,
          pickup_date, delivery_date, created_at
        FROM parcels WHERE driver_id = \$1 ORDER BY created_at DESC
      ''', parameters: [driverId]);

      return result
          .map((row) => ({
                'id': row[0],
                'trackingNumber': row[1],
                'senderName': row[2],
                'senderPhone': row[3],
                'receiverName': row[4],
                'receiverPhone': row[5],
                'description': row[6],
                'weight': row[7],
                'type': row[8],
                'status': row[9],
                'departureGarageName': row[10],
                'arrivalGarageName': row[11],
                'price': row[12],
                'totalAmount': row[13],
                'paymentMethod': row[14],
                'paymentStatus': row[15],
                'pickupDate': row[16] != null
                    ? (row[16] as DateTime).toIso8601String()
                    : null,
                'deliveryDate': row[17] != null
                    ? (row[17] as DateTime).toIso8601String()
                    : null,
                'createdAt': (row[18] as DateTime).toIso8601String(),
              }))
          .toList();
    } catch (e) {
      print('❌ Erreur getDriverParcels: $e');
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> getGarageParcels(String garageId) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute('''
        SELECT 
          p.id, p.tracking_number, p.sender_name, p.receiver_name, 
          p.receiver_phone, p.status, p.driver_id, p.driver_name,
          p.description, p.weight, p.type, p.price, p.total_amount, p.created_at
        FROM parcels p
        WHERE p.departure_garage_id = \$1 OR p.arrival_garage_id = \$1
        ORDER BY p.created_at DESC
      ''', parameters: [garageId]);

      return result
          .map((row) => ({
                'id': row[0],
                'trackingNumber': row[1],
                'senderName': row[2],
                'receiverName': row[3],
                'receiverPhone': row[4],
                'status': row[5],
                'driverId': row[6],
                'driverName': row[7],
                'description': row[8],
                'weight': row[9],
                'type': row[10],
                'price': row[11],
                'totalAmount': row[12],
                'createdAt': (row[13] as DateTime).toIso8601String(),
              }))
          .toList();
    } catch (e) {
      print('❌ Erreur getGarageParcels: $e');
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> getAllParcels() async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute('''
        SELECT id, tracking_number, sender_name, receiver_name, 
               status, total_amount, price, created_at
        FROM parcels ORDER BY created_at DESC
      ''');

      return result
          .map((row) => ({
                'id': row[0],
                'trackingNumber': row[1],
                'senderName': row[2],
                'receiverName': row[3],
                'status': row[4],
                'totalAmount': row[5],
                'price': row[6],
                'createdAt': (row[7] as DateTime).toIso8601String(),
              }))
          .toList();
    } catch (e) {
      print('❌ Erreur getAllParcels: $e');
      return [];
    }
  }

  // ==================== RECHERCHE ====================

  Future<Map<String, dynamic>?> getParcelByTrackingNumber(
      String trackingNumber) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute(
        'SELECT id FROM parcels WHERE tracking_number = \$1',
        parameters: [trackingNumber],
      );

      if (result.isEmpty) return null;

      final parcelId = result.first[0].toString();
      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur getParcelByTrackingNumber: $e');
      return null;
    }
  }

  Future<Map<String, dynamic>?> trackParcel(String trackingNumber) async {
    return await getParcelByTrackingNumber(trackingNumber);
  }

  // ==================== ÉVÉNEMENTS ====================

  Future<List<Map<String, dynamic>>> getParcelEvents(String parcelId) async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute('''
        SELECT 
          id, parcel_id, status, description, 
          location, location_lat, location_lng,
          user_id, user_name, user_role, photo_url,
          metadata, created_at
        FROM parcel_events 
        WHERE parcel_id::text = \$1
        ORDER BY created_at ASC
      ''', parameters: [parcelId]);

      return result.map((row) {
        dynamic metadataValue = row[11];
        Map<String, dynamic> metadata = {};

        if (metadataValue is Map) {
          metadata = Map<String, dynamic>.from(metadataValue);
        } else if (metadataValue is String && metadataValue.isNotEmpty) {
          try {
            final decoded = jsonDecode(metadataValue);
            if (decoded is Map) {
              metadata = Map<String, dynamic>.from(decoded);
            }
          } catch (e) {}
        }

        return {
          'id': row[0].toString(),
          'parcelId': row[1].toString(),
          'status': row[2].toString(),
          'description': row[3].toString(),
          'location': row[4]?.toString(),
          'locationLat': row[5]?.toString(),
          'locationLng': row[6]?.toString(),
          'userId': row[7]?.toString(),
          'userName': row[8]?.toString(),
          'userRole': row[9]?.toString(),
          'photoUrl': row[10]?.toString(),
          'metadata': metadata,
          'timestamp': (row[12] as DateTime).toIso8601String(),
        };
      }).toList();
    } catch (e) {
      print('❌ Erreur getParcelEvents: $e');
      return [];
    }
  }

  Future<void> createParcelEvent(
    String parcelId,
    String status,
    String description, {
    String? location,
    String? locationLat,
    String? locationLng,
    String? userId,
    String? userName,
    String? userRole,
    String? photoUrl,
    Map<String, dynamic>? metadata,
  }) async {
    final db = await DatabaseService.getInstance();
    final eventId = _uuid.v4();

    final columnsResult = await db.connection.execute('''
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'parcel_events'
    ''');

    final existingColumns = columnsResult.map((row) => row[0].toString()).toSet();

    final columns = ['id', 'parcel_id', 'status', 'description', 'created_at'];
    final values = [eventId, parcelId, status, description, DateTime.now()];

    if (existingColumns.contains('location') && location != null) {
      columns.add('location');
      values.add(location);
    }
    if (existingColumns.contains('location_lat') && locationLat != null) {
      columns.add('location_lat');
      values.add(locationLat);
    }
    if (existingColumns.contains('location_lng') && locationLng != null) {
      columns.add('location_lng');
      values.add(locationLng);
    }
    if (existingColumns.contains('user_id') && userId != null) {
      columns.add('user_id');
      values.add(userId);
    }
    if (existingColumns.contains('user_name') && userName != null) {
      columns.add('user_name');
      values.add(userName);
    }
    if (existingColumns.contains('user_role') && userRole != null) {
      columns.add('user_role');
      values.add(userRole);
    }
    if (existingColumns.contains('photo_url') && photoUrl != null) {
      columns.add('photo_url');
      values.add(photoUrl);
    }
    if (existingColumns.contains('metadata') && metadata != null) {
      columns.add('metadata');
      values.add(jsonEncode(metadata));
    }

    final placeholders = List.generate(values.length, (i) => '\$${i + 1}').join(', ');
    final sql = 'INSERT INTO parcel_events (${columns.join(', ')}) VALUES ($placeholders)';

    try {
      await db.connection.execute(sql, parameters: values);
    } catch (e) {
      print('⚠️ Erreur création événement: $e');
    }
  }

  // ==================== MISES À JOUR DE STATUT ====================

  Future<Map<String, dynamic>?> updateParcelStatus(
    String parcelId,
    String newStatus, {
    String? userId,
    String? userName,
    String? location,
    String? locationLat,
    String? locationLng,
    String? photoUrl,
    String? description,
  }) async {
    final db = await DatabaseService.getInstance();

    try {
      // Récupérer les infos pour notification
      final parcelInfo = await db.connection.execute('''
        SELECT p.tracking_number, p.sender_id, p.receiver_name, p.receiver_email,
               u.email as sender_email, u.full_name as sender_name
        FROM parcels p
        JOIN users u ON u.id = p.sender_id
        WHERE p.id = \$1
      ''', parameters: [parcelId]);

      if (parcelInfo.isNotEmpty) {
        final trackingNumber = parcelInfo.first[0].toString();
        final senderId = parcelInfo.first[1].toString();
        final receiverName = parcelInfo.first[2].toString();
        final receiverEmail = parcelInfo.first[3]?.toString();
        final senderEmail = parcelInfo.first[4].toString();
        final senderName = parcelInfo.first[5].toString();

        // Mettre à jour le statut
        await db.connection.execute(
          'UPDATE parcels SET status = \$2, updated_at = NOW() WHERE id = \$1',
          parameters: [parcelId, newStatus],
        );

        // Créer l'événement
        await createParcelEvent(
          parcelId,
          newStatus,
          description ?? _getStatusDescription(newStatus),
          location: location,
          locationLat: locationLat,
          locationLng: locationLng,
          userId: userId,
          userName: userName,
          photoUrl: photoUrl,
        );

        final statusLabel = _getStatusLabel(newStatus);

        // Envoyer notification à l'expéditeur
        if (senderEmail.isNotEmpty) {
          unawaited(
            _sendParcelNotification(
              toEmail: senderEmail,
              toPhone: '',
              trackingNumber: trackingNumber,
              status: newStatus,
              statusLabel: statusLabel,
              receiverName: receiverName,
              location: location,
              senderName: senderName,
            ).then((_) => print('✅ Email envoyé à $senderEmail'))
              .catchError((e) => print('❌ Erreur email: $e'))
          );
        }

        // Envoyer notification au destinataire
        if (receiverEmail != null && receiverEmail.isNotEmpty) {
          unawaited(
            _sendParcelNotification(
              toEmail: receiverEmail,
              toPhone: '',
              trackingNumber: trackingNumber,
              status: newStatus,
              statusLabel: statusLabel,
              receiverName: receiverName,
              location: location,
              senderName: senderName,
            ).then((_) => print('✅ Email envoyé à $receiverEmail'))
              .catchError((e) => print('❌ Erreur email: $e'))
          );
        }
      } else {
        await db.connection.execute(
          'UPDATE parcels SET status = \$2, updated_at = NOW() WHERE id = \$1',
          parameters: [parcelId, newStatus],
        );

        await createParcelEvent(
          parcelId,
          newStatus,
          description ?? _getStatusDescription(newStatus),
          location: location,
          locationLat: locationLat,
          locationLng: locationLng,
          userId: userId,
          userName: userName,
          photoUrl: photoUrl,
        );
      }

      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur updateParcelStatus: $e');
      return null;
    }
  }

  // ==================== ANNULATION ====================

  Future<Map<String, dynamic>?> cancelParcel(
    String parcelId,
    String userId, {
    String? reason,
    String? userName,
  }) async {
    final db = await DatabaseService.getInstance();

    try {
      final userResult = await db.connection.execute(
        'SELECT full_name FROM users WHERE id = \$1',
        parameters: [userId],
      );
      final cancelledByName = userName ??
          (userResult.isNotEmpty ? userResult.first[0].toString() : userId);

      await db.connection.execute('''
        UPDATE parcels 
        SET status = 'cancelled', 
            cancellation_reason = \$2,
            cancelled_by = \$3,
            cancelled_at = NOW(),
            updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [parcelId, reason, userId]);

      await createParcelEvent(
        parcelId,
        'cancelled',
        'Colis annulé: ${reason ?? "Annulation"}',
        userId: userId,
        userName: cancelledByName,
        metadata: {'type': 'cancellation', 'reason': reason},
      );

      // Envoyer notification d'annulation
      final parcelInfo = await db.connection.execute('''
        SELECT p.tracking_number, p.receiver_name, u.email as sender_email
        FROM parcels p
        JOIN users u ON u.id = p.sender_id
        WHERE p.id = \$1
      ''', parameters: [parcelId]);

      if (parcelInfo.isNotEmpty) {
        final trackingNumber = parcelInfo.first[0].toString();
        final receiverName = parcelInfo.first[1].toString();
        final senderEmail = parcelInfo.first[2].toString();

        unawaited(
          _sendParcelNotification(
            toEmail: senderEmail,
            toPhone: '',
            trackingNumber: trackingNumber,
            status: 'cancelled',
            statusLabel: 'Annulé',
            receiverName: receiverName,
            location: null,
          ).then((_) => print('✅ Email d\'annulation envoyé'))
            .catchError((e) => print('❌ Erreur email: $e'))
        );
      }

      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur cancelParcel: $e');
      return null;
    }
  }

  // ==================== MODIFICATION ====================

  Future<Map<String, dynamic>?> updateParcelInfo(
    String parcelId,
    Map<String, dynamic> updates, {
    String? updatedBy,
    String? updatedByName,
  }) async {
    final db = await DatabaseService.getInstance();

    try {
      final oldParcel = await getParcelById(parcelId);
      if (oldParcel == null) return null;

      final changes = <String, dynamic>{};
      final allowedFields = [
        'receiver_name',
        'receiver_phone',
        'receiver_email',
        'receiver_address',
        'description',
        'weight',
        'notes',
        'price',
        'total_amount'
      ];
      final setClauses = <String>[];
      final values = <dynamic>[parcelId];
      var index = 2;

      for (var entry in updates.entries) {
        if (allowedFields.contains(entry.key)) {
          setClauses.add('$entry.key = \$$index');
          values.add(entry.value);
          changes[entry.key] = {
            'old': oldParcel[entry.key],
            'new': entry.value
          };
          index++;
        }
      }

      if (setClauses.isNotEmpty) {
        await db.connection.execute(
          'UPDATE parcels SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = \$1',
          parameters: values,
        );

        await createParcelEvent(
          parcelId,
          oldParcel['status'] ?? 'pending',
          'Colis modifié par ${updatedByName ?? updatedBy}',
          userId: updatedBy,
          userName: updatedByName,
          metadata: {'type': 'modification', 'changes': changes},
        );
      }

      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur updateParcelInfo: $e');
      return null;
    }
  }

  // ==================== SUPPRESSION ====================

  Future<bool> deleteParcel(String parcelId,
      {String? deletedBy, String? deletedByName}) async {
    final db = await DatabaseService.getInstance();
    try {
      final parcel = await getParcelById(parcelId);
      if (parcel == null) return false;

      await createParcelEvent(
        parcelId,
        parcel['status'] ?? 'deleted',
        'Colis supprimé définitivement',
        userId: deletedBy,
        userName: deletedByName,
        metadata: {'type': 'deletion', 'deletedBy': deletedByName},
      );

      await db.connection.execute(
        'DELETE FROM parcels WHERE id = \$1',
        parameters: [parcelId],
      );
      return true;
    } catch (e) {
      print('❌ Erreur deleteParcel: $e');
      return false;
    }
  }

  // ==================== MÉTHODES CHAUFFEUR ====================

  Future<Map<String, dynamic>?> confirmPickup(
      String parcelId, String driverId) async {
    final db = await DatabaseService.getInstance();

    try {
      final driverResult = await db.connection.execute(
        'SELECT full_name FROM users WHERE id = \$1',
        parameters: [driverId],
      );
      final driverName = driverResult.first[0].toString();

      return await updateParcelStatus(
        parcelId,
        'picked_up',
        userId: driverId,
        userName: driverName,
        description: 'Colis ramassé par le chauffeur $driverName',
      );
    } catch (e) {
      print('❌ Erreur confirmPickup: $e');
      return null;
    }
  }

  Future<Map<String, dynamic>?> markAsInTransit(
      String parcelId, String driverId,
      {String? location}) async {
    final db = await DatabaseService.getInstance();

    try {
      final driverResult = await db.connection.execute(
        'SELECT full_name FROM users WHERE id = \$1',
        parameters: [driverId],
      );
      final driverName = driverResult.first[0].toString();

      return await updateParcelStatus(
        parcelId,
        'in_transit',
        userId: driverId,
        userName: driverName,
        location: location,
        description: 'Colis en transit vers le garage de destination',
      );
    } catch (e) {
      print('❌ Erreur markAsInTransit: $e');
      return null;
    }
  }

  Future<Map<String, dynamic>?> markAsArrived(String parcelId, String driverId,
      {String? location}) async {
    final db = await DatabaseService.getInstance();

    try {
      final driverResult = await db.connection.execute(
        'SELECT full_name FROM users WHERE id = \$1',
        parameters: [driverId],
      );
      final driverName = driverResult.first[0].toString();

      return await updateParcelStatus(
        parcelId,
        'arrived',
        userId: driverId,
        userName: driverName,
        location: location,
        description: 'Colis arrivé au garage de destination',
      );
    } catch (e) {
      print('❌ Erreur markAsArrived: $e');
      return null;
    }
  }

  Future<Map<String, dynamic>?> markAsOutForDelivery(
      String parcelId, String driverId,
      {String? location}) async {
    final db = await DatabaseService.getInstance();

    try {
      final driverResult = await db.connection.execute(
        'SELECT full_name FROM users WHERE id = \$1',
        parameters: [driverId],
      );
      final driverName = driverResult.first[0].toString();

      return await updateParcelStatus(
        parcelId,
        'out_for_delivery',
        userId: driverId,
        userName: driverName,
        location: location,
        description: 'Colis en cours de livraison',
      );
    } catch (e) {
      print('❌ Erreur markAsOutForDelivery: $e');
      return null;
    }
  }

  Future<Map<String, dynamic>?> confirmDelivery(
      String parcelId, String driverId, Map<String, dynamic> data) async {
    final db = await DatabaseService.getInstance();

    try {
      final driverResult = await db.connection.execute(
        'SELECT full_name FROM users WHERE id = \$1',
        parameters: [driverId],
      );
      final driverName = driverResult.first[0].toString();

      await db.connection.execute(
        'UPDATE parcels SET delivery_date = NOW(), signature_url = \$3, payment_status = \'paid\' WHERE id = \$1',
        parameters: [parcelId, driverId, data['signature']],
      );

      return await updateParcelStatus(
        parcelId,
        'delivered',
        userId: driverId,
        userName: driverName,
        description: 'Colis livré avec succès',
        photoUrl: data['photoUrl'],
      );
    } catch (e) {
      print('❌ Erreur confirmDelivery: $e');
      return null;
    }
  }

  // ==================== ASSIGNATION CHAUFFEUR ====================

  Future<Map<String, dynamic>?> assignDriverToParcel(
    String parcelId,
    String driverId, {
    String? assignedBy,
    String? assignedByName,
  }) async {
    final db = await DatabaseService.getInstance();

    try {
      final driverResult = await db.connection.execute(
        'SELECT full_name, phone FROM users WHERE id = \$1',
        parameters: [driverId],
      );

      final driverName = driverResult.first[0].toString();
      final driverPhone = driverResult.first[1].toString();

      await db.connection.execute('''
        UPDATE parcels 
        SET driver_id = \$2, driver_name = \$3, driver_phone = \$4, 
            status = 'confirmed', updated_at = NOW()
        WHERE id = \$1
      ''', parameters: [parcelId, driverId, driverName, driverPhone]);

      await createParcelEvent(
        parcelId,
        'confirmed',
        'Chauffeur assigné: $driverName',
        userId: assignedBy,
        userName: assignedByName,
        metadata: {
          'type': 'driver_assignment',
          'driverId': driverId,
          'driverName': driverName
        },
      );

      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur assignDriverToParcel: $e');
      return null;
    }
  }

  // ==================== STATISTIQUES ====================

  Future<Map<String, dynamic>> getGlobalStats() async {
    final parcels = await getAllParcels();
    return {
      'total': parcels.length,
      'pending': parcels.where((p) => p['status'] == 'pending').length,
      'confirmed': parcels.where((p) => p['status'] == 'confirmed').length,
      'inTransit': parcels.where((p) => p['status'] == 'in_transit').length,
      'delivered': parcels.where((p) => p['status'] == 'delivered').length,
      'cancelled': parcels.where((p) => p['status'] == 'cancelled').length,
    };
  }

  Future<Map<String, dynamic>> getDailyReport(String date) async {
    final parcels = await getAllParcels();
    final filtered = parcels
        .where((p) => p['createdAt'].toString().startsWith(date))
        .toList();
    return {
      'date': date,
      'totalParcels': filtered.length,
      'delivered': filtered.where((p) => p['status'] == 'delivered').length,
      'cancelled': filtered.where((p) => p['status'] == 'cancelled').length,
      'parcels': filtered,
    };
  }

  Future<Map<String, dynamic>> getMonthlyReport(int year, int month) async {
    final parcels = await getAllParcels();
    final filtered = parcels.where((p) {
      final date = DateTime.tryParse(p['createdAt'].toString());
      return date != null && date.year == year && date.month == month;
    }).toList();
    return {
      'year': year,
      'month': month,
      'totalParcels': filtered.length,
      'delivered': filtered.where((p) => p['status'] == 'delivered').length,
      'cancelled': filtered.where((p) => p['status'] == 'cancelled').length,
      'parcels': filtered,
    };
  }
}