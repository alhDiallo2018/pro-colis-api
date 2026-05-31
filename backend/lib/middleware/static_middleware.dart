// backend/lib/middleware/static_middleware.dart

import 'dart:convert';
// ignore: unused_import
import 'dart:io';

import 'package:shelf/shelf.dart';

/// Middleware pour les fichiers statiques (uniquement pour les assets)
/// Les fichiers uploadés sont maintenant sur Cloudinary
Middleware staticFilesMiddleware() {
  return (Handler inner) {
    return (Request request) async {
      final path = request.url.path;

      // ✅ Rediriger les requêtes d'upload locales vers une notice
      if (path.startsWith('uploads/')) {
        print('⚠️ Fichier local demandé: $path');
        print('   Les fichiers sont maintenant sur Cloudinary');
        
        // Rediriger vers une documentation ou retourner 410 (Gone)
        return Response(
          410,
          body: jsonEncode({
            'success': false,
            'message': 'Les fichiers sont maintenant hébergés sur Cloudinary',
            'migration': 'https://cloudinary.com/console'
          }),
          headers: {'Content-Type': 'application/json'},
        );
      }

      return inner(request);
    };
  };
}