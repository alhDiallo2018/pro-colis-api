import 'dart:io';

import 'package:logging/logging.dart';
import 'package:procolis_backend/middleware/cors_middleware.dart';
import 'package:procolis_backend/middleware/static_middleware.dart';
import 'package:procolis_backend/routes/index.dart';
import 'package:procolis_backend/services/database_service.dart';
import 'package:procolis_backend/services/email_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart';

void main() async {
  // ================= LOGS =================
  Logger.root.level = Level.INFO;
  Logger.root.onRecord.listen((record) {
    print('${record.level.name}: ${record.time}: ${record.message}');
  });

  // ================= ENVIRONNEMENT =================
  final isRender = Platform.environment['RENDER'] == 'true';
  final portEnv = Platform.environment['PORT'] ?? '8080';
  final port = int.parse(portEnv);
  final host = Platform.environment['HOST'] ?? '0.0.0.0';
  
  print('═══════════════════════════════════════════════════════════');
  print('🚀 PRO COLIS BACKEND v2.0');
  print('═══════════════════════════════════════════════════════════');
  print('🌍 Environnement: ${isRender ? 'RENDER (Production)' : 'LOCAL (Développement)'}');
  print('🔌 Port: $port');
  print('🏠 Host: $host');
  print('═══════════════════════════════════════════════════════════');

  // ================= BASE DE DONNÉES =================
  print('\n📊 CONFIGURATION BASE DE DONNÉES');
  print('─────────────────────────────────────────');
  
  final db = await DatabaseService.getInstance();

  if (!db.isConnected) {
    print('❌ Base de données non connectée!');
    print('⚠️ Le serveur démarre sans base de données');
  } else {
    print('✅ Base de données connectée avec succès');
  }
  print('─────────────────────────────────────────');

  // ================= EMAIL =================
  print('\n📧 CONFIGURATION EMAIL');
  print('─────────────────────────────────────────');
  
  late EmailService emailService;
  
  // Priorité 1: Clé API Brevo (Recommandé pour Render)
  final brevoApiKey = Platform.environment['BREVO_API_KEY'];
  final brevoFromEmail = Platform.environment['BREVO_FROM_EMAIL'];
  
  if (brevoApiKey != null && brevoApiKey.isNotEmpty) {
    // Utiliser l'API Brevo
    emailService = EmailService.forBrevo(
      apiKey: brevoApiKey,
      fromEmail: brevoFromEmail ?? 'alhassanegarki2018@gmail.com',
      fromName: Platform.environment['BREVO_FROM_NAME'] ?? 'PRO COLIS',
    );
    print('✅ Email configuré avec Brevo API');
    print('   API Key: ${brevoApiKey.substring(0, 10)}...');
    print('   From: ${brevoFromEmail ?? 'alhassanegarki2018@gmail.com'}');
  } else {
    // Fallback: Configuration SMTP standard
    print('📧 Configuration SMTP (fallback)');
    
    final smtpHost = Platform.environment['SMTP_HOST'] ?? 'smtp.gmail.com';
    final smtpPort = int.parse(Platform.environment['SMTP_PORT'] ?? '587');
    final smtpSecure = Platform.environment['SMTP_SECURE'] == 'true';
    final smtpUser = Platform.environment['SMTP_USER'] ?? '';
    final smtpPass = Platform.environment['SMTP_PASS'] ?? '';
    final smtpFrom = Platform.environment['SMTP_FROM'] ?? 'PRO COLIS <noreply@proscolis.sn>';
    
    if (smtpUser.isEmpty || smtpPass.isEmpty) {
      print('⚠️ ATTENTION: Credentials SMTP manquants!');
      print('   Les emails ne pourront pas être envoyés.');
    }
    
    emailService = EmailService.forSmtp(
      smtpHost: smtpHost,
      smtpPort: smtpPort,
      smtpSecure: smtpSecure,
      smtpUser: smtpUser,
      smtpPass: smtpPass,
      smtpFrom: smtpFrom,
      fromName: Platform.environment['SMTP_FROM_NAME'] ?? 'PRO COLIS',
    );
    
    print('   SMTP_HOST: $smtpHost');
    print('   SMTP_PORT: $smtpPort');
    print('   SMTP_USER: ${smtpUser.isNotEmpty ? smtpUser : '❌ Non configuré'}');
    print('   SMTP_PASS: ${smtpPass.isNotEmpty ? '✅ Configuré' : '❌ Manquant'}');
  }
  
  print('─────────────────────────────────────────');

  // ================= ROUTER =================
  print('\n🔄 INITIALISATION DES ROUTES');
  print('─────────────────────────────────────────');
  final router = AppRoutes.createRouter(emailService: emailService);
  print('✅ Routes initialisées');
  print('─────────────────────────────────────────');

  // ================= DOSSIERS UPLOADS =================
  print('\n📁 CONFIGURATION DES DOSSIERS');
  print('─────────────────────────────────────────');
  
  final uploadsDir = Directory('uploads');
  if (!await uploadsDir.exists()) {
    await uploadsDir.create(recursive: true);
    print('📁 Dossier uploads créé');
  }

  final parcelsDir = Directory('uploads/parcels');
  if (!await parcelsDir.exists()) {
    await parcelsDir.create(recursive: true);
    print('📁 Dossier uploads/parcels créé');
  }
  
  final profileDir = Directory('uploads/profile');
  if (!await profileDir.exists()) {
    await profileDir.create(recursive: true);
    print('📁 Dossier uploads/profile créé');
  }

  print('📁 STATIC PATH: ${uploadsDir.absolute.path}');
  print('─────────────────────────────────────────');

  // ================= PIPELINE =================
  print('\n🔧 CONFIGURATION DU SERVEUR');
  print('─────────────────────────────────────────');
  
  final handler = const Pipeline()
    .addMiddleware(logRequests())
    .addMiddleware(corsMiddleware())
    .addMiddleware(staticFilesMiddleware())
    .addHandler(router);

  print('✅ Middlewares configurés');
  print('─────────────────────────────────────────');

  // ================= SERVEUR =================
  print('\n🚀 DÉMARRAGE DU SERVEUR');
  print('─────────────────────────────────────────');
  
  final server = await serve(handler, host, port);

  print('');
  print('═══════════════════════════════════════════════════════════');
  print('✅ SERVEUR PRÊT !');
  print('═══════════════════════════════════════════════════════════');
  print('🌐 URL: http://$host:${server.port}');
  if (host != '0.0.0.0') {
    print('🌐 Local: http://localhost:${server.port}');
  }
  print('📁 Static: http://$host:${server.port}/uploads/');
  print('');
  print('📋 Routes disponibles:');
  print('   🔓 PUBLIQUES:');
  print('      POST   /auth/register');
  print('      POST   /auth/send-otp');
  print('      POST   /auth/verify-otp');
  print('      POST   /auth/login-with-pin');
  print('      GET    /public/garages');
  print('      GET    /health');
  print('');
  print('   🔒 PROTÉGÉES:');
  print('      GET    /auth/me');
  print('      PUT    /auth/profile');
  print('      POST   /auth/logout');
  print('      /client/*');
  print('      /driver/*');
  print('      /garage-admin/*');
  print('      /super-admin/*');
  print('═══════════════════════════════════════════════════════════');
}