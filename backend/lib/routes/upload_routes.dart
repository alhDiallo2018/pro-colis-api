// backend/lib/routes/upload_routes.dart
import 'dart:convert';
import 'dart:io';

import 'package:procolis_backend/services/cloudinary_service.dart';
import 'package:procolis_backend/services/database_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

class UploadRoutes {
  final _uuid = Uuid();
  late final CloudinaryService _cloudinary;
  late final bool useCloudinary;

  UploadRoutes() {
    // Vérifier si Cloudinary est configuré
    final cloudName = Platform.environment['CLOUDINARY_CLOUD_NAME'];
    final uploadPreset = Platform.environment['CLOUDINARY_UPLOAD_PRESET'];

    if (cloudName != null && uploadPreset != null) {
      // Mode Cloudinary
      _cloudinary = CloudinaryService.unsigned(
        cloudName: cloudName,
        uploadPreset: uploadPreset,
      );
      useCloudinary = true;
      print('✅ Cloudinary configuré: $cloudName');
    } else {
      useCloudinary = false;
      print('⚠️ Cloudinary non configuré, utilisation du stockage local');
    }
  }

  Router get router {
    final router = Router();

    // ✅ Upload photo de profil
    router.post('/profile-photo', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final userId = data['userId'];
        final filename = data['filename'] ?? 'profile.jpg';

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode(
                  {'success': false, 'message': 'Fichier manquant'}));
        }

        // Nettoyer le base64
        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        // Décoder le base64
        final bytes = base64Decode(cleanBase64);

        String? publicUrl;

        if (useCloudinary) {
          // Upload vers Cloudinary
          publicUrl = await _cloudinary.uploadFile(
            fileBytes: bytes,
            fileName: filename,
            folder: 'profiles/$userId',
          );
        } else {
          // Stockage local
          final uploadDir = Directory('uploads/profiles');
          if (!await uploadDir.exists()) {
            await uploadDir.create(recursive: true);
          }

          final extension = filename.split('.').last;
          final uniqueName = '${_uuid.v4()}.$extension';
          final filePath = '${uploadDir.path}/$uniqueName';

          final file = File(filePath);
          await file.writeAsBytes(bytes);

          publicUrl = '/uploads/profiles/$uniqueName';
        }

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode(
                  {'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

        // Mettre à jour la base de données
        final db = await DatabaseService.getInstance();
        await db.connection.execute(
          'UPDATE users SET profile_photo = \$1, updated_at = NOW() WHERE id = \$2',
          parameters: [publicUrl, userId],
        );

        print('✅ [PROFILE_PHOTO] Photo uploadée: $publicUrl');

        return Response.ok(
            jsonEncode({'success': true, 'url': publicUrl, 'userId': userId}));
      } catch (e) {
        print('❌ [PROFILE_PHOTO] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({
          'success': false,
          'message': e.toString(),
        }));
      }
    });

    // ✅ Upload photo de colis
    router.post('/parcel-photo', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final parcelId = data['parcelId'];
        final filename = data['filename'] ?? 'photo.jpg';
        final isTemp = data['isTemp'] ?? false;

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode(
                  {'success': false, 'message': 'Fichier manquant'}));
        }

        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        final bytes = base64Decode(cleanBase64);

        String? publicUrl;
        String? tempId;

        // ✅ Si c'est un ID temporaire ou "temp", stocker dans un dossier temporaire
        if (parcelId == 'temp' ||
            parcelId == null ||
            parcelId.isEmpty ||
            isTemp) {
          final tempDir = Directory('uploads/temp');
          if (!await tempDir.exists()) {
            await tempDir.create(recursive: true);
          }

          final extension = filename.split('.').last;
          tempId = _uuid.v4().toString();
          final uniqueName = '$tempId.$extension';
          final filePath = '${tempDir.path}/$uniqueName';

          final file = File(filePath);
          await file.writeAsBytes(bytes);

          publicUrl = '/uploads/temp/$uniqueName';

          print('✅ [PARCEL_PHOTO] Photo temporaire stockée: $publicUrl');

          return Response.ok(jsonEncode({
            'success': true,
            'url': publicUrl,
            'tempId': tempId,
            'isTemp': true
          }));
        }

        // ✅ Vérifier si parcelId est un UUID valide
        final uuidRegex = RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            caseSensitive: false);
        final isValidUuid = uuidRegex.hasMatch(parcelId);

        if (!isValidUuid) {
          // Stocker comme temporaire aussi
          final tempDir = Directory('uploads/temp');
          if (!await tempDir.exists()) {
            await tempDir.create(recursive: true);
          }

          final extension = filename.split('.').last;
          tempId = _uuid.v4().toString();
          final uniqueName = '$tempId.$extension';
          final filePath = '${tempDir.path}/$uniqueName';

          final file = File(filePath);
          await file.writeAsBytes(bytes);

          publicUrl = '/uploads/temp/$uniqueName';

          return Response.ok(jsonEncode({
            'success': true,
            'url': publicUrl,
            'tempId': tempId,
            'isTemp': true
          }));
        }

        // ✅ Upload normal vers Cloudinary ou stockage local
        if (useCloudinary) {
          publicUrl = await _cloudinary.uploadFile(
            fileBytes: bytes,
            fileName: filename,
            folder: 'parcels/$parcelId',
          );
        } else {
          final uploadDir = Directory('uploads/parcels/$parcelId');
          if (!await uploadDir.exists()) {
            await uploadDir.create(recursive: true);
          }

          final extension = filename.split('.').last;
          final uniqueName = '${_uuid.v4()}.$extension';
          final filePath = '${uploadDir.path}/$uniqueName';

          final file = File(filePath);
          await file.writeAsBytes(bytes);

          publicUrl = '/uploads/parcels/$parcelId/$uniqueName';
        }

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode(
                  {'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

        // Mettre à jour les photos du colis
        final db = await DatabaseService.getInstance();
        await db.connection.execute(
          'UPDATE parcels SET photo_urls = array_append(photo_urls, \$1) WHERE id = \$2',
          parameters: [publicUrl, parcelId],
        );

        print('✅ [PARCEL_PHOTO] Photo uploadée: $publicUrl');

        return Response.ok(jsonEncode(
            {'success': true, 'url': publicUrl, 'parcelId': parcelId}));
      } catch (e) {
        print('❌ [PARCEL_PHOTO] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({
          'success': false,
          'message': e.toString(),
        }));
      }
    });

// ✅ Route pour associer les photos temporaires à un colis après création
    router.post('/attach-temp-photos', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final tempIds = data['tempIds'] as List<dynamic>? ?? [];
        final parcelId = data['parcelId'];

        if (tempIds.isEmpty) {
          return Response.ok(jsonEncode({'success': true}));
        }

        final db = await DatabaseService.getInstance();
        final List<String> photoUrls = [];

        for (final tempId in tempIds) {
          // Chercher le fichier temporaire
          final tempDir = Directory('uploads/temp');
          final files = await tempDir.list().toList();

          for (final file in files) {
            if (file.path.contains(tempId.toString())) {
              final extension = file.path.split('.').last;
              final newFileName = '${_uuid.v4()}.$extension';
              final newDir = Directory('uploads/parcels/$parcelId');

              if (!await newDir.exists()) {
                await newDir.create(recursive: true);
              }

              final newPath = '${newDir.path}/$newFileName';
              await File(file.path).rename(newPath);

              final publicUrl = '/uploads/parcels/$parcelId/$newFileName';
              photoUrls.add(publicUrl);
              break;
            }
          }
        }

        // Mettre à jour la base de données
        for (final url in photoUrls) {
          await db.connection.execute(
            'UPDATE parcels SET photo_urls = array_append(photo_urls, \$1) WHERE id = \$2',
            parameters: [url, parcelId],
          );
        }

        return Response.ok(
            jsonEncode({'success': true, 'attachedPhotos': photoUrls}));
      } catch (e) {
        print('❌ [ATTACH_PHOTOS] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // ✅ Upload vidéo de colis
    router.post('/parcel-video', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final parcelId = data['parcelId'];
        final filename = data['filename'] ?? 'video.mp4';

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode(
                  {'success': false, 'message': 'Fichier manquant'}));
        }

        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        final bytes = base64Decode(cleanBase64);

        String? publicUrl;

        if (useCloudinary) {
          publicUrl = await _cloudinary.uploadFile(
            fileBytes: bytes,
            fileName: filename,
            folder: 'parcels/$parcelId/videos',
          );
        } else {
          final uploadDir = Directory('uploads/parcels/videos');
          if (!await uploadDir.exists()) {
            await uploadDir.create(recursive: true);
          }

          final extension = filename.split('.').last;
          final uniqueName = '${_uuid.v4()}.$extension';
          final filePath = '${uploadDir.path}/$uniqueName';

          final file = File(filePath);
          await file.writeAsBytes(bytes);

          publicUrl = '/uploads/parcels/videos/$uniqueName';
        }

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode(
                  {'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

        print('✅ [PARCEL_VIDEO] Vidéo uploadée: $publicUrl');

        return Response.ok(jsonEncode(
            {'success': true, 'url': publicUrl, 'parcelId': parcelId}));
      } catch (e) {
        print('❌ [PARCEL_VIDEO] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({
          'success': false,
          'message': e.toString(),
        }));
      }
    });

    // ✅ Upload base64 générique
    router.post('/base64', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final type = data['type'] ?? 'general';
        final filename = data['filename'] ?? 'file.jpg';

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode(
                  {'success': false, 'message': 'Fichier manquant'}));
        }

        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        final bytes = base64Decode(cleanBase64);

        String? publicUrl;

        if (useCloudinary) {
          final folder = type == 'profile' ? 'profiles' : 'uploads';
          publicUrl = await _cloudinary.uploadFile(
            fileBytes: bytes,
            fileName: filename,
            folder: folder,
          );
        } else {
          final uploadDir = Directory('uploads/$type');
          if (!await uploadDir.exists()) {
            await uploadDir.create(recursive: true);
          }

          final extension = filename.split('.').last;
          final uniqueName = '${_uuid.v4()}.$extension';
          final filePath = '${uploadDir.path}/$uniqueName';

          final file = File(filePath);
          await file.writeAsBytes(bytes);

          publicUrl = '/uploads/$type/$uniqueName';
        }

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode(
                  {'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

        print('✅ [BASE64] Fichier uploadé: $publicUrl');

        return Response.ok(jsonEncode(
            {'success': true, 'url': publicUrl, 'fileId': _uuid.v4()}));
      } catch (e) {
        print('❌ [BASE64] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    return router;
  }
}
