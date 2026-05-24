import 'dart:io';

import 'package:logging/logging.dart';
import 'package:procolis_backend/middleware/cors_middleware.dart';
import 'package:procolis_backend/middleware/static_middleware.dart';
import 'package:procolis_backend/routes/index.dart';
import 'package:procolis_backend/services/database_service.dart';
import 'package:procolis_backend/services/email_service.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart';
import 'package:shelf_static/shelf_static.dart';

void main() async {
  // ================= LOGS =================
  Logger.root.level = Level.INFO;
  Logger.root.onRecord.listen((record) {
    print('${record.level.name}: ${record.time}: ${record.message}');
  });

  // ================= ENV =================
  // Utiliser Platform.environment pour Render
  final portEnv = Platform.environment['PORT'] ?? '8080';
  final port = int.parse(portEnv);
  
  final host = Platform.environment['HOST'] ?? '0.0.0.0';
  
  print('🌍 Environnement: ${Platform.environment['RENDER'] == 'true' ? 'Render' : 'Local'}');
  print('🔌 Port: $port');
  print('🏠 Host: $host');

  // ================= DB =================
  print('🔄 Initialisation de la base de données...');
  
  // Récupérer les variables d'environnement pour PostgreSQL
  final dbHost = Platform.environment['DB_HOST'];
  final dbName = Platform.environment['DB_NAME'];
  final dbUser = Platform.environment['DB_USER'];
  final dbPassword = Platform.environment['DB_PASSWORD'];
  
  if (dbHost == null || dbName == null || dbUser == null) {
    print('⚠️ Variables DB manquantes, utilisation de la config locale');
  } else {
    print('📊 Base distante: $dbHost/$dbName');
  }
  
  final db = await DatabaseService.getInstance();

  if (!db.isConnected) {
    print('❌ Base de données non connectée! Ono');
    // Ne pas quitter, le serveur peut démarrer même sans DB
    print('⚠️ Le serveur démarre sans base de données');
  } else {
    print('✅ Base de données initialisée--on ok');
  }

  // ================= EMAIL =================
  final smtpHost = Platform.environment['SMTP_HOST'] ?? 'smtp.gmail.com';
  final smtpPort = int.parse(Platform.environment['SMTP_PORT'] ?? '587');
  final smtpSecure = Platform.environment['SMTP_SECURE'] == 'true';
  final smtpUser = Platform.environment['SMTP_USER'] ?? '';
  final smtpPass = Platform.environment['SMTP_PASS'] ?? '';
  final smtpFrom = Platform.environment['SMTP_FROM'] ?? 'PRO COLIS <noreply@proscolis.sn>';
  
  final emailService = EmailService(
    smtpHost: smtpHost,
    smtpPort: smtpPort,
    smtpSecure: smtpSecure,
    smtpUser: smtpUser,
    smtpPass: smtpPass,
    smtpFrom: smtpFrom,
  );

  print('📧 Email configuré: $smtpHost');

  // ================= ROUTER =================
  final router = AppRoutes.createRouter(emailService: emailService);

  // ================= UPLOADS DIR =================
  final uploadsDir = Directory('uploads');

  if (!await uploadsDir.exists()) {
    await uploadsDir.create(recursive: true);
    print('📁 Dossier uploads créé');
  }

  // Créer les sous-dossiers
  final parcelsDir = Directory('uploads/parcels');
  if (!await parcelsDir.exists()) {
    await parcelsDir.create(recursive: true);
  }
  
  final profileDir = Directory('uploads/profile');
  if (!await profileDir.exists()) {
    await profileDir.create(recursive: true);
  }

  print("📁 STATIC PATH: ${uploadsDir.absolute.path}");
  print("📁 EXISTS: ${await uploadsDir.exists()}");
  print("📁 PARCELS: ${await parcelsDir.exists()}");
  print("📁 PROFILE: ${await profileDir.exists()}");

  // ================= STATIC HANDLER =================
  final staticHandler = createStaticHandler(
    'uploads',
    listDirectories: false,
    defaultDocument: 'index.html',
  );

  // ================= PIPELINE =================
  final handler = const Pipeline()
    .addMiddleware(logRequests())
    .addMiddleware(corsMiddleware())
    .addMiddleware(staticFilesMiddleware())
    .addHandler(router);

  print("CWD = ${Directory.current.path}");
  print("ABS uploads = ${Directory('uploads').absolute.path}");
  print("EXISTS = ${Directory('uploads').existsSync()}");

  // ================= SERVER =================
  final server = await serve(handler, host, port);

  print('');
  print('🚀 PRO COLIS BACKEND v2.0');
  print('👉 http://$host:${server.port}');
  if (host != '0.0.0.0') {
    print('👉 http://localhost:${server.port}');
  }
  print('📁 STATIC: http://$host:${server.port}/uploads/');
  print('');
  print('✅ Serveur prêt !');
}