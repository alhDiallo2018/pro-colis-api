// backend/lib/services/parcel_service.dart
import 'dart:convert';

import 'package:procolis_backend/services/database_service.dart';
import 'package:uuid/uuid.dart';

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

  // ==================== VÉRIFICATION DES COLONNES ====================
  
  Future<Map<String, bool>> _checkColumns() async {
    final db = await DatabaseService.getInstance();
    final columns = {
      'total_amount': false,
      'delivery_fees': false,
      'urgent_fee': false,
      'insurance_amount': false,
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

  // Créer un colis avec tous les champs
  Future<Map<String, dynamic>> createParcel(
      String userId, Map<String, dynamic> data) async {
    final db = await DatabaseService.getInstance();
    final parcelId = _uuid.v4();
    final trackingNumber = _generateTrackingNumber();

    // Vérifier les colonnes disponibles
    final availableColumns = await _checkColumns();
    
    print('📝 Insertion colis:');
    print('  - trackingNumber: $trackingNumber');
    print('  - totalAmount: ${data['totalAmount']} FCFA');

    // Récupérer le rôle de l'utilisateur
    final userResult = await db.connection.execute(
      'SELECT full_name, phone, role FROM users WHERE id = \$1',
      parameters: [userId],
    );

    final currentUserName = userResult.first[0].toString();
    final currentUserPhone = userResult.first[1].toString();
    final userRole = userResult.first[2].toString();
    final isDriver = userRole == 'driver';
    final initialStatus = isDriver ? 'confirmed' : 'pending';

    // Auto-assignation du chauffeur
    final driverId = isDriver ? userId : data['driverId']?.toString();
    final driverName = isDriver ? currentUserName : data['driverName']?.toString();
    final driverPhone = isDriver ? currentUserPhone : data['driverPhone']?.toString();

    // Données expéditeur
    final senderName = data['senderName']?.toString();
    final senderPhone = data['senderPhone']?.toString();
    final senderEmail = data['senderEmail']?.toString();
    final String? senderId = data['senderId'] != null && data['senderId'].toString().isNotEmpty
        ? data['senderId'].toString()
        : null;

    // Données destinataire
    final receiverName = data['receiverName']?.toString();
    final receiverPhone = data['receiverPhone']?.toString();
    final receiverEmail = data['receiverEmail']?.toString();
    final receiverAddress = data['receiverAddress']?.toString();

    // Trajet
    final arrivalGarageId = data['arrivalGarageId']?.toString();
    final arrivalGarageName = data['arrivalGarageName']?.toString();
    final notes = data['notes']?.toString();
    final pickupDate = data['pickupDate']?.toString();
    final estimatedDeliveryDate = data['estimatedDeliveryDate']?.toString();

    // Médias
    final photoUrlsJson = jsonEncode(data['photoUrls'] ?? []);
    final videoUrlsJson = jsonEncode(data['videoUrls'] ?? []);

    // Options
    final isInsured = data['isInsured'] == true;
    final isUrgent = data['isUrgent'] == true;
    final price = data['price'] != null ? (data['price'] as num).toDouble() : 0;
    final deliveryFees = data['deliveryFees'] != null ? (data['deliveryFees'] as num).toDouble() : 0;
    
    // Calculs
    double? urgentFee = isUrgent ? 500.0 : null;
    double? insuranceAmount = (isInsured && price > 0) ? price * 0.02 : null;
    double? totalAmount = data['totalAmount'] != null 
        ? (data['totalAmount'] as num).toDouble() 
        : price + deliveryFees + (isUrgent ? 500 : 0) + (isInsured && price > 0 ? price * 0.02 : 0);

    // Paiement
    final paymentMethod = data['paymentMethod']?.toString();
    final paymentPhoneNumber = data['paymentPhoneNumber']?.toString();
    final paymentStatus = 'pending';

    print('  - price: $price');
    print('  - deliveryFees: $deliveryFees');
    print('  - totalAmount: $totalAmount');
    print('  - urgent: $isUrgent');
    print('  - insured: $isInsured');

    // Construction de la requête de base
    final columns = [
      'id', 'tracking_number',
      'sender_id', 'sender_name', 'sender_phone', 'sender_email',
      'receiver_name', 'receiver_phone', 'receiver_email', 'receiver_address',
      'description', 'weight', 'type', 'status',
      'departure_garage_id', 'departure_garage_name',
      'arrival_garage_id', 'arrival_garage_name',
      'driver_id', 'driver_name', 'driver_phone',
      'price', 'is_urgent', 'is_insured',
      'payment_method', 'payment_phone_number', 'payment_status',
      'photo_urls', 'video_urls',
      'notes', 'pickup_date', 'estimated_delivery_date',
      'created_by', 'created_at', 'updated_at'
    ];

    final values = [
      parcelId, trackingNumber,
      senderId, senderName, senderPhone, senderEmail,
      receiverName, receiverPhone, receiverEmail, receiverAddress,
      data['description']?.toString() ?? '', (data['weight'] as num).toDouble(), data['type']?.toString() ?? 'package', initialStatus,
      data['departureGarageId']?.toString(), data['departureGarageName']?.toString(),
      arrivalGarageId, arrivalGarageName,
      driverId, driverName, driverPhone,
      price, isUrgent, isInsured,
      paymentMethod, paymentPhoneNumber, paymentStatus,
      photoUrlsJson, videoUrlsJson,
      notes, pickupDate, estimatedDeliveryDate,
      userId, DateTime.now(), DateTime.now()
    ];

    // Ajouter les colonnes optionnelles si elles existent
    if (availableColumns['total_amount'] == true) {
      columns.add('total_amount');
      values.add(totalAmount);
    }
    
    if (availableColumns['delivery_fees'] == true) {
      columns.add('delivery_fees');
      values.add(deliveryFees);
    }
    
    if (availableColumns['urgent_fee'] == true && urgentFee != null) {
      columns.add('urgent_fee');
      values.add(urgentFee);
    }
    
    if (availableColumns['insurance_amount'] == true && insuranceAmount != null) {
      columns.add('insurance_amount');
      values.add(insuranceAmount);
    }

    // Construire la requête SQL
    final placeholders = List.generate(values.length, (i) => '\$${i + 1}').join(', ');
    final sql = 'INSERT INTO parcels (${columns.join(', ')}) VALUES ($placeholders)';
    
    print('📝 SQL: $sql');

    try {
      await db.connection.execute(sql, parameters: values);

      // Ajouter les photos dans parcel_photos si la table existe
      if (data['photoUrls'] != null && (data['photoUrls'] as List).isNotEmpty) {
        try {
          for (final photoUrl in data['photoUrls']) {
            await db.connection.execute(
              'INSERT INTO parcel_photos (parcel_id, url) VALUES (\$1, \$2)',
              parameters: [parcelId, photoUrl.toString()],
            );
          }
        } catch (e) {
          print('⚠️ Table parcel_photos non trouvée: $e');
        }
      }

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
          'isUrgent': isUrgent,
          'isInsured': isInsured,
          'clientName': senderName,
          'clientPhone': senderPhone,
          'totalAmount': totalAmount,
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

  // Récupérer les colis d'un utilisateur
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

  // Récupérer un colis par ID
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
          return [];
        }
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
        'photoUrls': safeJsonDecode(row[32]),
        'videoUrls': safeJsonDecode(row[33]),
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

  // Récupérer les colis d'un chauffeur
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

      return result.map((row) => {
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
        'pickupDate': row[16] != null ? (row[16] as DateTime).toIso8601String() : null,
        'deliveryDate': row[17] != null ? (row[17] as DateTime).toIso8601String() : null,
        'createdAt': (row[18] as DateTime).toIso8601String(),
      }).toList();
    } catch (e) {
      print('❌ Erreur getDriverParcels: $e');
      return [];
    }
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

    try {
      await db.connection.execute('''
        INSERT INTO parcel_events (
          id, parcel_id, status, description, 
          location, location_lat, location_lng,
          user_id, user_name, user_role, photo_url,
          metadata, created_at
        ) VALUES (
          \$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, NOW()
        )
      ''', parameters: [
        eventId, parcelId, status, description,
        location, locationLat, locationLng,
        userId, userName, userRole, photoUrl,
        metadata != null ? jsonEncode(metadata) : null,
      ]);
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

      return await getParcelById(parcelId);
    } catch (e) {
      print('❌ Erreur updateParcelStatus: $e');
      return null;
    }
  }

  // backend/lib/services/parcel_service.dart
// AJOUTEZ CES MÉTHODES À LA FIN DU FICHIER

  // ==================== RECHERCHE PAR NUMÉRO DE SUIVI ====================

  // Récupérer un colis par numéro de suivi
  Future<Map<String, dynamic>?> getParcelByTrackingNumber(String trackingNumber) async {
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

  // Suivre un colis (alias)
  Future<Map<String, dynamic>?> trackParcel(String trackingNumber) async {
    return await getParcelByTrackingNumber(trackingNumber);
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
        'receiver_name', 'receiver_phone', 'receiver_email', 'receiver_address',
        'description', 'weight', 'notes', 'price', 'total_amount'
      ];
      final setClauses = <String>[];
      final values = <dynamic>[parcelId];
      var index = 2;

      for (var entry in updates.entries) {
        if (allowedFields.contains(entry.key)) {
          setClauses.add('$entry.key = \$$index');
          values.add(entry.value);
          changes[entry.key] = {'old': oldParcel[entry.key], 'new': entry.value};
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

  // ==================== MÉTHODES ADMIN GARAGE ====================

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
        'totalAmount': row[12],
        'createdAt': (row[13] as DateTime).toIso8601String(),
      })).toList();
    } catch (e) {
      print('❌ Erreur getGarageParcels: $e');
      return [];
    }
  }

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

  // ==================== MÉTHODES SUPER ADMIN ====================

  Future<List<Map<String, dynamic>>> getAllParcels() async {
    final db = await DatabaseService.getInstance();

    try {
      final result = await db.connection.execute('''
        SELECT id, tracking_number, sender_name, receiver_name, 
               status, total_amount, price, created_at
        FROM parcels ORDER BY created_at DESC
      ''');

      return result.map((row) => ({
        'id': row[0],
        'trackingNumber': row[1],
        'senderName': row[2],
        'receiverName': row[3],
        'status': row[4],
        'totalAmount': row[5],
        'price': row[6],
        'createdAt': (row[7] as DateTime).toIso8601String(),
      })).toList();
    } catch (e) {
      print('❌ Erreur getAllParcels: $e');
      return [];
    }
  }

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