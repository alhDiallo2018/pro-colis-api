// backend/lib/services/cloudinary_service.dart
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

class CloudinaryService {
  final String cloudName;
  final String? apiKey;
  final String? apiSecret;
  final String? uploadPreset;
  final _log = Logger('CloudinaryService');

  // Constructeur pour upload signé (avec apiKey/apiSecret)
  CloudinaryService.signed({
    required this.cloudName,
    required this.apiKey,
    required this.apiSecret,
  }) : uploadPreset = null;

  // Constructeur pour upload non signé (avec uploadPreset)
  CloudinaryService.unsigned({
    required this.cloudName,
    required this.uploadPreset,
  }) : apiKey = null, apiSecret = null;

  /// Upload un fichier vers Cloudinary
  Future<String?> uploadFile({
    required List<int> fileBytes,
    required String fileName,
    String folder = 'procolis',
  }) async {
    try {
      final url = Uri.parse('https://api.cloudinary.com/v1_1/$cloudName/upload');
      
      // Créer le multipart request
      final request = http.MultipartRequest('POST', url);
      
      // Ajouter les paramètres selon le mode
      if (apiKey != null && apiSecret != null) {
        // Mode signé
        final timestamp = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        final signature = _generateSignature(
          timestamp: timestamp,
          folder: folder,
        );
        request.fields['api_key'] = apiKey!;
        request.fields['timestamp'] = timestamp.toString();
        request.fields['signature'] = signature;
      } else if (uploadPreset != null) {
        // Mode non signé
        request.fields['upload_preset'] = uploadPreset!;
      } else {
        _log.severe('❌ Aucune méthode d\'authentification configurée');
        return null;
      }
      
      request.fields['folder'] = folder;
      
      request.files.add(http.MultipartFile.fromBytes(
        'file',
        fileBytes,
        filename: fileName,
      ));
      
      final response = await request.send();
      final responseBody = await response.stream.bytesToString();
      final data = jsonDecode(responseBody);
      
      if (response.statusCode == 200) {
        final secureUrl = data['secure_url'];
        _log.info('✅ Fichier uploadé sur Cloudinary: $secureUrl');
        return secureUrl;
      } else {
        _log.severe('❌ Erreur Cloudinary: ${data['error']['message']}');
        return null;
      }
    } catch (e) {
      _log.severe('❌ Exception Cloudinary: $e');
      return null;
    }
  }

  /// Génère la signature pour l'upload
  String _generateSignature({
    required int timestamp,
    required String folder,
  }) {
    final apiSecret = this.apiSecret!;
    final toSign = 'folder=$folder&timestamp=$timestamp$apiSecret';
    // Pour une vraie signature, utilisez le package crypto
    return toSign.hashCode.toString();
  }
}