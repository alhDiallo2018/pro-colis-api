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
          return Response.badRequest(body: jsonEncode({
            'success': false,
            'message': 'Fichier manquant'
          }));
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
          return Response.internalServerError(body: jsonEncode({
            'success': false,
            'message': 'Erreur lors de l\'upload'
          }));
        }
        
        // Mettre à jour la base de données
        final db = await DatabaseService.getInstance();
        await db.connection.execute(
          'UPDATE users SET profile_photo = \$1, updated_at = NOW() WHERE id = \$2',
          parameters: [publicUrl, userId],
        );
        
        print('✅ [PROFILE_PHOTO] Photo uploadée: $publicUrl');
        
        return Response.ok(jsonEncode({
          'success': true,
          'url': publicUrl,
          'userId': userId
        }));
      } catch (e) {
        print('❌ [PROFILE_PHOTO] Erreur: $e');
        return Response.internalServerError(body: jsonEncode({
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
        
        if (base64File == null || base64File.isEmpty) {
          return Response.badRequest(body: jsonEncode({
            'success': false,
            'message': 'Fichier manquant'
          }));
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
            folder: 'parcels/$parcelId',
          );
        } else {
          final uploadDir = Directory('uploads/parcels');
          if (!await uploadDir.exists()) {
            await uploadDir.create(recursive: true);
          }
          
          final extension = filename.split('.').last;
          final uniqueName = '${_uuid.v4()}.$extension';
          final filePath = '${uploadDir.path}/$uniqueName';
          
          final file = File(filePath);
          await file.writeAsBytes(bytes);
          
          publicUrl = '/uploads/parcels/$uniqueName';
        }
        
        if (publicUrl == null) {
          return Response.internalServerError(body: jsonEncode({
            'success': false,
            'message': 'Erreur lors de l\'upload'
          }));
        }
        
        // Mettre à jour les photos du colis
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
        return Response.internalServerError(body: jsonEncode({
          'success': false,
          'message': e.toString(),
        }));
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
          return Response.badRequest(body: jsonEncode({
            'success': false,
            'message': 'Fichier manquant'
          }));
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
          return Response.internalServerError(body: jsonEncode({
            'success': false,
            'message': 'Erreur lors de l\'upload'
          }));
        }
        
        print('✅ [PARCEL_VIDEO] Vidéo uploadée: $publicUrl');
        
        return Response.ok(jsonEncode({
          'success': true,
          'url': publicUrl,
          'parcelId': parcelId
        }));
      } catch (e) {
        print('❌ [PARCEL_VIDEO] Erreur: $e');
        return Response.internalServerError(body: jsonEncode({
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
          return Response.badRequest(body: jsonEncode({
            'success': false,
            'message': 'Fichier manquant'
          }));
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
          return Response.internalServerError(body: jsonEncode({
            'success': false,
            'message': 'Erreur lors de l\'upload'
          }));
        }
        
        print('✅ [BASE64] Fichier uploadé: $publicUrl');
        
        return Response.ok(jsonEncode({
          'success': true,
          'url': publicUrl,
          'fileId': _uuid.v4()
        }));
      } catch (e) {
        print('❌ [BASE64] Erreur: $e');
        return Response.internalServerError(body: jsonEncode({
          'success': false,
          'message': e.toString()
        }));
      }
    });
    
    return router;
  }
}