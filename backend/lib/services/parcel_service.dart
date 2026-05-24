import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../utils/db_helper.dart';

class ParcelService {
  final _uuid = const Uuid();

  // Générer un numéro de suivi unique
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

  // ==================== CRÉATION ====================

  // Créer un colis avec tous les champs
  Future<Map<String, dynamic>> createParcel(String userId, Map<String, dynamic> data) async {
  final db = await DbHelper.getInstance();
  final parcelId = _uuid.v4();
  final trackingNumber = _generateTrackingNumber();

  // Récupérer le rôle de l'utilisateur
  final userRoleResult = await db.connection.execute(
    'SELECT full_name, phone, role FROM users WHERE id = \$1',
    parameters: [userId],
  );

  final senderName = userRoleResult.first[0].toString();
  final senderPhone = userRoleResult.first[1].toString();
  final userRole = userRoleResult.first[2].toString();

  // Déterminer le statut initial et le driver_id
  // Si l'utilisateur est un chauffeur, il est automatiquement assigné
  final isDriver = userRole == 'driver';
  final initialStatus = isDriver ? 'confirmed' : 'pending';
  
  // Si c'est un chauffeur, il est assigné automatiquement
  final driverId = isDriver ? userId : data['driverId']?.toString();
  final driverName = isDriver ? senderName : data['driverName']?.toString();
  final driverPhone = isDriver ? senderPhone : data['driverPhone']?.toString();

  // Nettoyer les données
  final receiverAddress = data['receiverAddress']?.toString();
  final receiverEmail = data['receiverEmail']?.toString();
  final arrivalGarageId = data['arrivalGarageId']?.toString();
  final arrivalGarageName = data['arrivalGarageName']?.toString();
  final notes = data['notes']?.toString();
  final pickupDate = data['pickupDate']?.toString();
  final estimatedDeliveryDate = data['estimatedDeliveryDate']?.toString();

  // Convertir les URLs en JSON string
  final photoUrlsJson = jsonEncode(data['photoUrls'] ?? []);
  final videoUrlsJson = jsonEncode(data['videoUrls'] ?? []);

  // Valeurs booléennes
  final isInsured = data['isInsured'] == true;
  final isUrgent = data['isUrgent'] == true;
  
  // Prix
  final price = data['price'] != null ? (data['price'] as num).toDouble() : null;
  
  // Frais d'urgence
  final urgentFee = isUrgent ? 500.0 : null;

  print('📝 Insertion colis:');
  print('  - trackingNumber: $trackingNumber');
  print('  - userRole: $userRole');
  print('  - initialStatus: $initialStatus');
  print('  - driverId: $driverId');
  print('  - isUrgent: $isUrgent');
  print('  - isInsured: $isInsured');

  await db.connection.execute(
    '''
    INSERT INTO parcels (
      id, tracking_number, 
      sender_id, sender_name, sender_phone,
      receiver_name, receiver_phone, receiver_email, receiver_address,
      description, weight, type, status,
      departure_garage_id, departure_garage_name,
      arrival_garage_id, arrival_garage_name,
      driver_id, driver_name, driver_phone,
      price, urgent_fee,
      photo_urls, video_urls,
      is_insured, is_urgent,
      notes, pickup_date, estimated_delivery_date,
      created_by, created_at, updated_at
    ) VALUES (
      \$1, \$2, \$3, \$4, \$5,
      \$6, \$7, \$8, \$9,
      \$10, \$11, \$12, \$13,
      \$14, \$15, \$16, \$17,
      \$18, \$19, \$20,
      \$21, \$22,
      \$23, \$24,
      \$25, \$26,
      \$27, \$28, \$29,
      \$30, NOW(), NOW()
    )
    ''',
    parameters: [
      parcelId,
      trackingNumber,
      userId,
      senderName,
      senderPhone,
      data['receiverName'].toString(),
      data['receiverPhone'].toString(),
      receiverEmail,
      receiverAddress,
      data['description'].toString(),
      (data['weight'] as num).toDouble(),
      data['type']?.toString() ?? 'package',
      initialStatus,  // Statut: 'confirmed' pour chauffeur, 'pending' pour client
      data['departureGarageId'].toString(),
      data['departureGarageName'].toString(),
      arrivalGarageId,
      arrivalGarageName,
      driverId,
      driverName,
      driverPhone,
      price,
      urgentFee,
      photoUrlsJson,
      videoUrlsJson,
      isInsured,
      isUrgent,
      notes,
      pickupDate,
      estimatedDeliveryDate,
      userId,
    ],
  );

  // Ajouter les photos dans parcel_photos
  if (data['photoUrls'] != null && (data['photoUrls'] as List).isNotEmpty) {
    for (final photoUrl in data['photoUrls']) {
      await db.connection.execute(
        'INSERT INTO parcel_photos (parcel_id, url) VALUES (\$1, \$2)',
        parameters: [parcelId, photoUrl.toString()],
      );
    }
  }

  // Créer l'événement initial
  final eventStatus = initialStatus;
  final eventDescription = isDriver 
      ? 'Colis créé et assigné automatiquement au chauffeur ${senderName}'
      : 'Colis créé avec succès';
  
  await createParcelEvent(
    parcelId,
    eventStatus,
    eventDescription,
    userId: userId,
    userName: senderName,
    metadata: {
      'type': 'creation',
      'weight': data['weight'],
      'trackingNumber': trackingNumber,
      'isUrgent': isUrgent,
      'isInsured': isInsured,
      'autoAssigned': isDriver,
    },
  );

  // Si c'est un chauffeur, ajouter un événement supplémentaire pour le ramassage
  if (isDriver) {
    await createParcelEvent(
      parcelId,
      'confirmed',
      'Colis confirmé et prêt pour le ramassage',
      userId: userId,
      userName: senderName,
      metadata: {
        'type': 'confirmation',
        'driverId': driverId,
        'driverName': driverName,
      },
    );
  }

  return {
    'id': parcelId,
    'trackingNumber': trackingNumber,
    'status': initialStatus,
    'createdAt': DateTime.now().toIso8601String(),
    'driverId': driverId,
    'driverName': driverName,
  };
}

  // ==================== LECTURE ====================

  // Récupérer les colis d'un utilisateur
  Future<List<Map<String, dynamic>>> getUserParcels(String userId,
      {String? status}) async {
    final db = await DbHelper.getInstance();

    try {
      var query = '''
        SELECT 
          id, tracking_number, receiver_name, receiver_phone,
          description, weight, type, status,
          price, payment_status, photo_urls,
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

      return result.map((row) => ({
            'id': row[0],
            'trackingNumber': row[1],
            'receiverName': row[2],
            'receiverPhone': row[3],
            'description': row[4],
            'weight': row[5],
            'type': row[6],
            'status': row[7],
            'price': row[8],
            'paymentStatus': row[9],
            'photoUrls': row[10] != null ? jsonDecode(row[10].toString()) : [],
            'departureGarageName': row[11],
            'arrivalGarageName': row[12],
            'driverName': row[13],
            'driverPhone': row[14],
            'pickupDate': row[15] != null
                ? (row[15] as DateTime).toIso8601String()
                : null,
            'deliveryDate': row[16] != null
                ? (row[16] as DateTime).toIso8601String()
                : null,
            'createdAt': (row[17] as DateTime).toIso8601String(),
            'updatedAt': row[18] != null
                ? (row[18] as DateTime).toIso8601String()
                : null,
          })).toList();
    } catch (e) {
      print('❌ Erreur getUserParcels: $e');
      return [];
    }
  }

  // Récupérer un colis par ID (complet)
  Future<Map<String, dynamic>?> getParcelById(String parcelId) async {
  final db = await DbHelper.getInstance();

  try {
    final result = await db.connection.execute(
      '''
      SELECT 
        id, tracking_number,
        sender_id, sender_name, sender_phone,
        receiver_name, receiver_phone, receiver_email, receiver_address,
        description, weight, length, width, height, type, status,
        departure_garage_id, departure_garage_name,
        arrival_garage_id, arrival_garage_name,
        driver_id, driver_name, driver_phone,
        price, delivery_fees, total_amount,
        payment_method, payment_status,
        photo_urls, video_urls, signature_url,
        is_insured, insurance_amount, is_urgent, urgent_fee,
        notes, pickup_date, delivery_date, estimated_delivery_date,
        created_by, created_at, updated_at,
        cancelled_by, cancellation_reason, cancelled_at
      FROM parcels WHERE id = \$1
      ''',
      parameters: [parcelId],
    );

    if (result.isEmpty) return null;

    final row = result.first;
    
    // Fonction sécurisée pour convertir en double
    double? toDouble(dynamic value) {
      if (value == null) return null;
      if (value is double) return value;
      if (value is int) return value.toDouble();
      if (value is String) {
        if (value.isEmpty) return null;
        return double.tryParse(value);
      }
      return null;
    }
    
    // Fonction sécurisée pour les booléens
    bool toBool(dynamic value) {
      if (value == null) return false;
      if (value is bool) return value;
      if (value is String) return value.toLowerCase() == 'true';
      return false;
    }
    
    // Fonction sécurisée pour décoder le JSON
    List<String> safeJsonDecode(dynamic value) {
      if (value == null) return [];
      final str = value.toString();
      if (str.isEmpty || str == 'null' || str == '[]') return [];
      try {
        final decoded = jsonDecode(str);
        if (decoded is List) {
          return decoded.map((e) => e.toString()).toList();
        }
        return [];
      } catch (e) {
        print('⚠️ Erreur décodage JSON: $e pour valeur: $str');
        return [];
      }
    }

    // Récupérer les événements
    final events = await getParcelEvents(parcelId);

    return {
      'id': row[0],
      'trackingNumber': row[1],
      'senderId': row[2],
      'senderName': row[3],
      'senderPhone': row[4],
      'receiverName': row[5],
      'receiverPhone': row[6],
      'receiverEmail': row[7],
      'receiverAddress': row[8],
      'description': row[9],
      'weight': toDouble(row[10]),
      'length': toDouble(row[11]),
      'width': toDouble(row[12]),
      'height': toDouble(row[13]),
      'type': row[14],
      'status': row[15],
      'departureGarageId': row[16],
      'departureGarageName': row[17],
      'arrivalGarageId': row[18],
      'arrivalGarageName': row[19],
      'driverId': row[20],
      'driverName': row[21],
      'driverPhone': row[22],
      'price': toDouble(row[23]),
      'deliveryFees': toDouble(row[24]),
      'totalAmount': toDouble(row[25]),
      'paymentMethod': row[26],
      'paymentStatus': row[27],
      'photoUrls': safeJsonDecode(row[28]),
      'videoUrls': safeJsonDecode(row[29]),
      'signatureUrl': row[30],
      'isInsured': toBool(row[31]),
      'insuranceAmount': toDouble(row[32]),
      'isUrgent': toBool(row[33]),
      'urgentFee': toDouble(row[34]),
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

  // Récupérer un colis par numéro de suivi
  Future<Map<String, dynamic>?> getParcelByTrackingNumber(
      String trackingNumber) async {
    final db = await DbHelper.getInstance();

    try {
      final result = await db.connection.execute(
        'SELECT id FROM parcels WHERE tracking_number = \$1',
        parameters: [trackingNumber],
      );

      if (result.isEmpty) return null;

      // Convertir Object? en String
      final parcelId = result.first[0].toString();
      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur getParcelByTrackingNumber: $e');
      return null;
    }
  }

  // Suivre un colis (alias)
  Future<Map<String, dynamic>?> trackParcel(String trackingNumber) async {
    return await getParcelByTrackingNumber(trackingNumber);
  }

  // Récupérer les colis d'un chauffeur
  Future<List<Map<String, dynamic>>> getDriverParcels(String driverId) async {
    final db = await DbHelper.getInstance();

    try {
      final result = await db.connection.execute(
        '''
        SELECT id, tracking_number, receiver_name, receiver_phone,
               description, weight, type, status,
               departure_garage_name, arrival_garage_name,
               price, payment_status, photo_urls,
               pickup_date, delivery_date, created_at
        FROM parcels WHERE driver_id = \$1 ORDER BY created_at DESC
        ''',
        parameters: [driverId],
      );

      return result.map((row) => ({
            'id': row[0],
            'trackingNumber': row[1],
            'receiverName': row[2],
            'receiverPhone': row[3],
            'description': row[4],
            'weight': row[5],
            'type': row[6],
            'status': row[7],
            'departureGarageName': row[8],
            'arrivalGarageName': row[9],
            'price': row[10],
            'paymentStatus': row[11],
            'photoUrls': row[12] != null ? jsonDecode(row[12].toString()) : [],
            'pickupDate': row[13] != null
                ? (row[13] as DateTime).toIso8601String()
                : null,
            'deliveryDate': row[14] != null
                ? (row[14] as DateTime).toIso8601String()
                : null,
            'createdAt': (row[15] as DateTime).toIso8601String(),
          })).toList();
    } catch (e) {
      print('❌ Erreur getDriverParcels: $e');
      return [];
    }
  }

  // Récupérer les colis d'un garage
  Future<List<Map<String, dynamic>>> getGarageParcels(String garageId) async {
    final db = await DbHelper.getInstance();

    try {
      final result = await db.connection.execute(
        '''
        SELECT 
          p.id, p.tracking_number, p.sender_name, p.receiver_name, 
          p.receiver_phone, p.status, p.driver_id, p.driver_name,
          p.description, p.weight, p.type, p.price, p.created_at
        FROM parcels p
        WHERE p.departure_garage_id = \$1 OR p.arrival_garage_id = \$1
        ORDER BY p.created_at DESC
        ''',
        parameters: [garageId],
      );

      return result.map((row) => ({
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
            'createdAt': (row[12] as DateTime).toIso8601String(),
          })).toList();
    } catch (e) {
      print('❌ Erreur getGarageParcels: $e');
      return [];
    }
  }

  // Récupérer tous les colis (admin)
  Future<List<Map<String, dynamic>>> getAllParcels() async {
    final db = await DbHelper.getInstance();

    try {
      final result = await db.connection.execute(
        '''
        SELECT id, tracking_number, sender_name, receiver_name, 
               status, price, created_at
        FROM parcels ORDER BY created_at DESC
        ''',
      );

      return result.map((row) => ({
            'id': row[0],
            'trackingNumber': row[1],
            'senderName': row[2],
            'receiverName': row[3],
            'status': row[4],
            'price': row[5],
            'createdAt': (row[6] as DateTime).toIso8601String(),
          })).toList();
    } catch (e) {
      print('❌ Erreur getAllParcels: $e');
      return [];
    }
  }

  // ==================== ÉVÉNEMENTS ====================

  // Récupérer les événements d'un colis
  Future<List<Map<String, dynamic>>> getParcelEvents(String parcelId) async {
    final db = await DbHelper.getInstance();

    try {
      final result = await db.connection.execute(
        '''
        SELECT 
          id, parcel_id, status, description, 
          location, location_lat, location_lng,
          user_id, user_name, user_role, photo_url,
          metadata, created_at
        FROM parcel_events 
        WHERE parcel_id = \$1 
        ORDER BY created_at ASC
        ''',
        parameters: [parcelId],
      );

      return result.map((row) => ({
            'id': row[0],
            'parcelId': row[1],
            'status': row[2],
            'description': row[3],
            'location': row[4],
            'locationLat': row[5],
            'locationLng': row[6],
            'userId': row[7],
            'userName': row[8],
            'userRole': row[9],
            'photoUrl': row[10],
            'metadata': row[11] != null ? jsonDecode(row[11].toString()) : null,
            'timestamp': (row[12] as DateTime).toIso8601String(),
          })).toList();
    } catch (e) {
      print('❌ Erreur getParcelEvents: $e');
      return [];
    }
  }

  // Créer un événement
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
    final db = await DbHelper.getInstance();
    final eventId = _uuid.v4();

    await db.connection.execute(
      '''
      INSERT INTO parcel_events (
        id, parcel_id, status, description, 
        location, location_lat, location_lng,
        user_id, user_name, user_role, photo_url,
        metadata, created_at
      ) VALUES (
        \$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, NOW()
      )
      ''',
      parameters: [
        eventId,
        parcelId,
        status,
        description,
        location,
        locationLat,
        locationLng,
        userId,
        userName,
        userRole,
        photoUrl,
        metadata != null ? jsonEncode(metadata) : null,
      ],
    );
  }

  // ==================== MISES À JOUR ====================

  // Mettre à jour le statut avec événement
  Future<Map<String, dynamic>?> updateParcelStatus(
    String parcelId,
    String status, {
    String? userId,
    String? userName,
    String? location,
    String? locationLat,
    String? locationLng,
    String? photoUrl,
    String? description,
  }) async {
    final db = await DbHelper.getInstance();

    try {
      await db.connection.execute(
        '''
        UPDATE parcels 
        SET status = \$2, updated_at = NOW() 
        WHERE id = \$1
        ''',
        parameters: [parcelId, status],
      );

      await createParcelEvent(
        parcelId,
        status,
        description ?? _getStatusDescription(status),
        location: location,
        locationLat: locationLat,
        locationLng: locationLng,
        userId: userId,
        userName: userName,
        photoUrl: photoUrl,
      );

      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur updateParcelStatus: $e');
      return null;
    }
  }

  // Confirmer le ramassage
  Future<Map<String, dynamic>?> confirmPickup(
      String parcelId, String driverId) async {
    return await updateParcelStatus(
      parcelId,
      'picked_up',
      userId: driverId,
      description: 'Colis ramassé par le chauffeur',
    );
  }

  // Confirmer la livraison
  Future<Map<String, dynamic>?> confirmDelivery(
      String parcelId, String driverId, Map<String, dynamic> data) async {
    final db = await DbHelper.getInstance();

    try {
      await db.connection.execute(
        '''
        UPDATE parcels 
        SET status = 'delivered', 
            signature_url = \$3, 
            delivery_date = NOW(), 
            updated_at = NOW()
        WHERE id = \$1 AND driver_id = \$2
        ''',
        parameters: [parcelId, driverId, data['signature']],
      );

      await createParcelEvent(
        parcelId,
        'delivered',
        'Colis livré avec succès',
        userId: driverId,
        metadata: {'signature': data['signature']},
      );

      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur confirmDelivery: $e');
      return null;
    }
  }

  // Assigner un chauffeur à un colis
  Future<void> assignDriverToParcel(String parcelId, String driverId) async {
    final db = await DbHelper.getInstance();

    final driverResult = await db.connection.execute(
      'SELECT full_name, phone FROM users WHERE id = \$1',
      parameters: [driverId],
    );

    final driverName = driverResult.first[0].toString();
    final driverPhone = driverResult.first[1].toString();

    await db.connection.execute(
      '''
      UPDATE parcels 
      SET driver_id = \$2, driver_name = \$3, driver_phone = \$4, 
          status = 'confirmed', updated_at = NOW()
      WHERE id = \$1
      ''',
      parameters: [parcelId, driverId, driverName, driverPhone],
    );

    await createParcelEvent(
      parcelId,
      'confirmed',
      'Chauffeur assigné: $driverName',
      metadata: {'driverId': driverId, 'driverName': driverName},
    );
  }

  // Assigner un chauffeur (alias avec retour)
  Future<Map<String, dynamic>?> assignDriver(
    String parcelId,
    String driverId, {
    String? assignerId,
    String? assignerName,
  }) async {
    await assignDriverToParcel(parcelId, driverId);
    return await getParcelById(parcelId);
  }

  // Annuler un colis avec raison
  Future<void> cancelParcelWithReason(
      String parcelId, String userId, String? reason) async {
    final db = await DbHelper.getInstance();

    await db.connection.execute(
      '''
      UPDATE parcels 
      SET status = 'cancelled', 
          cancellation_reason = \$2,
          cancelled_by = \$3,
          cancelled_at = NOW(),
          updated_at = NOW()
      WHERE id = \$1
      ''',
      parameters: [parcelId, reason, userId],
    );

    await createParcelEvent(
      parcelId,
      'cancelled',
      'Colis annulé: ${reason ?? "Annulation"}',
      userId: userId,
    );
  }

  // Annuler un colis (avec retour)
  Future<Map<String, dynamic>?> cancelParcel(
    String parcelId,
    String userId, {
    String? reason,
  }) async {
    await cancelParcelWithReason(parcelId, userId, reason);
    return await getParcelById(parcelId);
  }

  // Mettre à jour un colis
  Future<void> updateParcel(String parcelId, Map<String, dynamic> data) async {
    final db = await DbHelper.getInstance();

    await db.connection.execute(
      '''
      UPDATE parcels 
      SET status = \$2, price = \$3, driver_id = \$4, updated_at = NOW()
      WHERE id = \$1
      ''',
      parameters: [parcelId, data['status'], data['price'], data['driverId']],
    );
  }

  // ==================== SUPPRESSION ====================

  // Supprimer un colis
  Future<bool> deleteParcel(String parcelId) async {
    final db = await DbHelper.getInstance();

    try {
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
}