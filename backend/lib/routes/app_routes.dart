
// lib/routes/index.dart
import 'package:procolis_backend/routes/index.dart';
import 'package:procolis_backend/services/email_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

class AppRoutes {
  static Router createRouter({required EmailService emailService}) {
    final router = Router();
    
    // Montage des routes par rôle
    router.mount('/auth', AuthRoutes(emailService: emailService).router);
    router.mount('/public', PublicRoutes(emailService: emailService).router);
    router.mount('/client', ClientRoutes(emailService: emailService).router);
    router.mount('/driver', DriverRoutes(emailService: emailService).router);
    router.mount('/garage-admin', GarageAdminRoutes(emailService: emailService).router);
    router.mount('/super-admin', SuperAdminRoutes(emailService: emailService).router);
    router.mount('/upload', UploadRoutes().router);
    
    // Route racine
    router.get('/', (Request request) {
      return Response.ok('{"message": "PRO COLIS API v2.0", "status": "running"}');
    });
    
    return router;
  }
}