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
  late final CloudinaryService? _cloudinary;
  late final bool useCloudinary;

  UploadRoutes() {
    // Vérifier si Cloudinary est configuré
    final cloudName = Platform.environment['CLOUDINARY_CLOUD_NAME'];
    final uploadPreset = Platform.environment['CLOUDINARY_UPLOAD_PRESET'];
    final apiKey = Platform.environment['CLOUDINARY_API_KEY'];
    final apiSecret = Platform.environment['CLOUDINARY_API_SECRET'];

    if (cloudName != null && uploadPreset != null) {
      try {
        _cloudinary = CloudinaryService.unsigned(
          cloudName: cloudName,
          uploadPreset: uploadPreset,
        );
        useCloudinary = true;
        print('✅ Cloudinary configuré avec upload preset: $cloudName');
      } catch (e) {
        print('⚠️ Erreur configuration Cloudinary: $e');
        useCloudinary = false;
        _cloudinary = null;
      }
    } else if (cloudName != null && apiKey != null && apiSecret != null) {
      try {
        _cloudinary = CloudinaryService.signed(
          cloudName: cloudName,
          apiKey: apiKey,
          apiSecret: apiSecret,
        );
        useCloudinary = true;
        print('✅ Cloudinary configuré avec clés API: $cloudName');
      } catch (e) {
        print('⚠️ Erreur configuration Cloudinary: $e');
        useCloudinary = false;
        _cloudinary = null;
      }
    } else {
      useCloudinary = false;
      _cloudinary = null;
      print('⚠️ Cloudinary non configuré, utilisation du stockage local');
    }
  }

  Router get router {
    final router = Router();

    // ==================== PHOTO DE PROFIL ====================
    
    router.post('/profile-photo', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final userId = data['userId'];
        final filename = data['filename'] ?? 'profile.jpg';

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode({'success': false, 'message': 'Fichier manquant'}));
        }

        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        final bytes = base64Decode(cleanBase64);
        final String? publicUrl = await _uploadToCloudinaryOrLocal(
          bytes: bytes,
          filename: filename,
          folder: 'profiles/$userId',
        );

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode({'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

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
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // ==================== PHOTO DE COLIS ====================
    
    router.post('/parcel-photo', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final parcelId = data['parcelId'];
        final filename = data['filename'] ?? 'photo.jpg';

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode({'success': false, 'message': 'Fichier manquant'}));
        }

        // Vérifier que le parcelId est un UUID valide
        if (!_isValidUuid(parcelId)) {
          return Response.badRequest(
              body: jsonEncode({'success': false, 'message': 'ID de colis invalide'}));
        }

        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        final bytes = base64Decode(cleanBase64);
        
        final String? publicUrl = await _uploadToCloudinaryOrLocal(
          bytes: bytes,
          filename: filename,
          folder: 'parcels/$parcelId',
        );

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode({'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

        // Mettre à jour la base de données
        final db = await DatabaseService.getInstance();
        await db.connection.execute(
          'UPDATE parcels SET photo_urls = array_append(photo_urls, \$1) WHERE id = \$2',
          parameters: [publicUrl, parcelId],
        );

        print('✅ [PARCEL_PHOTO] Photo uploadée: $publicUrl');

        return Response.ok(jsonEncode({
          'success': true,
          'url': publicUrl,
          'parcelId': parcelId
        }));
      } catch (e) {
        print('❌ [PARCEL_PHOTO] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // ==================== VIDÉO DE COLIS ====================
    
    router.post('/parcel-video', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final parcelId = data['parcelId'];
        final filename = data['filename'] ?? 'video.mp4';

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode({'success': false, 'message': 'Fichier manquant'}));
        }

        // Vérifier que le parcelId est un UUID valide
        if (!_isValidUuid(parcelId)) {
          return Response.badRequest(
              body: jsonEncode({'success': false, 'message': 'ID de colis invalide'}));
        }

        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        final bytes = base64Decode(cleanBase64);
        
        final String? publicUrl = await _uploadToCloudinaryOrLocal(
          bytes: bytes,
          filename: filename,
          folder: 'parcels/$parcelId/videos',
        );

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode({'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

        print('✅ [PARCEL_VIDEO] Vidéo uploadée: $publicUrl');

        return Response.ok(jsonEncode({
          'success': true,
          'url': publicUrl,
          'parcelId': parcelId
        }));
      } catch (e) {
        print('❌ [PARCEL_VIDEO] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    // ==================== UPLOAD GÉNÉRIQUE BASE64 ====================
    
    router.post('/base64', (Request request) async {
      try {
        final body = await request.readAsString();
        final data = jsonDecode(body);

        final base64File = data['file'];
        final type = data['type'] ?? 'general';
        final filename = data['filename'] ?? 'file.jpg';

        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(
              body: jsonEncode({'success': false, 'message': 'Fichier manquant'}));
        }

        String cleanBase64 = base64File;
        if (base64File.contains(',')) {
          cleanBase64 = base64File.split(',').last;
        }

        final bytes = base64Decode(cleanBase64);
        
        final String? publicUrl = await _uploadToCloudinaryOrLocal(
          bytes: bytes,
          filename: filename,
          folder: type == 'profile' ? 'profiles' : 'uploads',
        );

        if (publicUrl == null) {
          return Response.internalServerError(
              body: jsonEncode({'success': false, 'message': 'Erreur lors de l\'upload'}));
        }

        print('✅ [BASE64] Fichier uploadé: $publicUrl');

        return Response.ok(jsonEncode({
          'success': true,
          'url': publicUrl,
          'fileId': _uuid.v4()
        }));
      } catch (e) {
        print('❌ [BASE64] Erreur: $e');
        return Response.internalServerError(
            body: jsonEncode({'success': false, 'message': e.toString()}));
      }
    });

    return router;
  }

  // ==================== MÉTHODES UTILITAIRES ====================

  /// Upload vers Cloudinary ou stockage local selon la configuration
  Future<String?> _uploadToCloudinaryOrLocal({
    required List<int> bytes,
    required String filename,
    required String folder,
  }) async {
    if (useCloudinary && _cloudinary != null) {
      try {
        final url = await _cloudinary!.uploadFile(
          fileBytes: bytes,
          fileName: filename,
          folder: folder,
        );
        if (url != null) {
          print('✅ [CLOUDINARY] Upload réussi: $url');
          return url;
        }
        print('⚠️ [CLOUDINARY] Échec, fallback vers stockage local');
      } catch (e) {
        print('❌ [CLOUDINARY] Erreur: $e, fallback vers stockage local');
      }
    }
    
    // Stockage local
    return await _saveToLocal(bytes, filename, folder);
  }

  /// Sauvegarde locale du fichier
  Future<String> _saveToLocal(List<int> bytes, String filename, String folder) async {
    final uploadDir = Directory('uploads/$folder');
    if (!await uploadDir.exists()) {
      await uploadDir.create(recursive: true);
    }

    final extension = filename.split('.').last;
    final uniqueName = '${_uuid.v4()}.$extension';
    final filePath = '${uploadDir.path}/$uniqueName';

    final file = File(filePath);
    await file.writeAsBytes(bytes);

    final publicUrl = '/uploads/$folder/$uniqueName';
    print('✅ [LOCAL] Fichier sauvegardé: $publicUrl');
    
    return publicUrl;
  }

  /// Vérifie si une chaîne est un UUID valide
  bool _isValidUuid(String uuid) {
    final regex = RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        caseSensitive: false);
    return regex.hasMatch(uuid);
  }
}