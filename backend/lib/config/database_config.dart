// lib/config/database_config.dart
import 'dart:io';

import 'package:dotenv/dotenv.dart' show DotEnv;

class DatabaseConfig {
  static DatabaseConfig? _instance;

  late final String host;
  late final int port;
  late final String database;
  late final String username;
  late final String password;
  late final bool useSsl;

  DatabaseConfig._internal();

  static Future<DatabaseConfig> getInstance() async {
    _instance ??= DatabaseConfig._internal();
    await _instance!._loadConfig();
    return _instance!;
  }

  /// Parse une URL PostgreSQL complète
  /// Format: postgresql://user:password@host:port/database
  void _parsePostgresUrl(String url) {
    try {
      print('🔍 Parsing DATABASE_URL...');
      
      // Enlever le préfixe postgresql://
      String withoutPrefix = url.replaceFirst(RegExp(r'^postgresql://'), '');
      
      // Séparer user:password@host:port/database
      final atIndex = withoutPrefix.indexOf('@');
      if (atIndex == -1) {
        throw FormatException('URL PostgreSQL invalide: pas de @');
      }
      
      final userPassPart = withoutPrefix.substring(0, atIndex);
      final hostPart = withoutPrefix.substring(atIndex + 1);
      
      // Extraire user et password
      final colonIndex = userPassPart.indexOf(':');
      if (colonIndex == -1) {
        throw FormatException('URL PostgreSQL invalide: pas de : dans user:password');
      }
      
      username = userPassPart.substring(0, colonIndex);
      // Décoder le mot de passe (remplacer %40 par @, %23 par #, etc.)
      password = Uri.decodeComponent(userPassPart.substring(colonIndex + 1));
      
      // Extraire host, port et database
      final slashIndex = hostPart.indexOf('/');
      String hostPortPart;
      String dbPart;
      
      if (slashIndex == -1) {
        hostPortPart = hostPart;
        dbPart = 'postgres';
      } else {
        hostPortPart = hostPart.substring(0, slashIndex);
        dbPart = hostPart.substring(slashIndex + 1);
      }
      
      // Extraire host et port
      final lastColonIndex = hostPortPart.lastIndexOf(':');
      if (lastColonIndex == -1) {
        host = hostPortPart;
        port = 5432;
      } else {
        host = hostPortPart.substring(0, lastColonIndex);
        port = int.tryParse(hostPortPart.substring(lastColonIndex + 1)) ?? 5432;
      }
      
      database = dbPart.isNotEmpty ? dbPart : 'postgres';
      
      // SSL activé par défaut pour les connexions externes
      useSsl = host.contains('supabase.co') || 
               host.contains('pooler.supabase.com') ||
               (host != 'localhost' && host != '127.0.0.1');
      
      print('✅ URL parsée avec succès');
      _printConfig();
      
    } catch (e, stackTrace) {
      print('❌ Erreur parsing URL: $e');
      print(stackTrace);
      
      // Fallback sur les variables d'environnement
      _loadFromEnv();
    }
  }

  /// Charge la configuration depuis les variables d'environnement
  void _loadFromEnv() {
    final envHost = Platform.environment['DB_HOST'];
    final envPort = Platform.environment['DB_PORT'];
    final envDatabase = Platform.environment['DB_DATABASE'] ?? 
                         Platform.environment['DB_NAME'];
    final envUsername = Platform.environment['DB_USERNAME'] ?? 
                         Platform.environment['DB_USER'];
    final envPassword = Platform.environment['DB_PASSWORD'];

    if (envHost != null && envHost.isNotEmpty) {
      print('🌍 Configuration depuis variables d\'environnement');
      
      host = envHost;
      port = int.tryParse(envPort ?? '5432') ?? 5432;
      database = envDatabase ?? 'postgres';
      username = envUsername ?? 'postgres';
      // Décoder le mot de passe si nécessaire
      password = envPassword != null ? Uri.decodeComponent(envPassword) : '';
      useSsl = host.contains('supabase.co') || 
               host.contains('pooler.supabase.com') ||
               (host != 'localhost' && host != '127.0.0.1');
      
      _printConfig();
      return;
    }

    // Fallback local
    _loadFromDotEnv();
  }

  /// Charge la configuration depuis le fichier .env
  void _loadFromDotEnv() {
    final env = DotEnv(includePlatformEnvironment: false);

    try {
      env.load();
      print('🏠 Configuration locale (.env)');
      
      // Vérifier si .env contient une URL
      final localDbUrl = env['DATABASE_URL'] ?? env['DB_URL'];
      if (localDbUrl != null && localDbUrl.isNotEmpty) {
        _parsePostgresUrl(localDbUrl);
        return;
      }
      
    } catch (_) {
      print('⚠️ Aucun fichier .env trouvé, utilisation des valeurs par défaut');
    }

    host = env['DB_HOST'] ?? 'localhost';
    port = int.tryParse(env['DB_PORT'] ?? '5432') ?? 5432;
    database = env['DB_DATABASE'] ?? env['DB_NAME'] ?? 'postgres';
    username = env['DB_USERNAME'] ?? env['DB_USER'] ?? 'postgres';
    password = env['DB_PASSWORD'] != null ? Uri.decodeComponent(env['DB_PASSWORD']!) : '';
    
    // SSL obligatoire pour Supabase
    useSsl = host.contains('supabase.co') || 
             host.contains('pooler.supabase.com') ||
             (host != 'localhost' && host != '127.0.0.1');

    _printConfig();
  }

  Future<void> _loadConfig() async {
    // 1. Vérifier si une URL complète est fournie (priorité maximale)
    final dbUrl = Platform.environment['DATABASE_URL'] ?? 
                   Platform.environment['DB_URL'] ?? 
                   Platform.environment['SUPABASE_DB_URL'];
    
    if (dbUrl != null && dbUrl.isNotEmpty) {
      print('📡 DATABASE_URL détectée');
      _parsePostgresUrl(dbUrl);
      return;
    }

    // 2. Variables d'environnement Render/Supabase
    final envHost = Platform.environment['DB_HOST'];
    if (envHost != null && envHost.isNotEmpty) {
      _loadFromEnv();
      return;
    }

    // 3. Fichier .env
    _loadFromDotEnv();
  }

  void _printConfig() {
    print('═══════════════════════════════════════════════════════════');
    print('📋 CONFIGURATION BASE DE DONNÉES');
    print('═══════════════════════════════════════════════════════════');
    print('🏠 Host: $host');
    print('🔌 Port: $port');
    print('🗄️  Database: $database');
    print('👤 Username: $username');
    print('🔒 SSL: ${useSsl ? '✅ Activé' : '❌ Désactivé'}');
    print('═══════════════════════════════════════════════════════════');
    // Ne pas afficher le mot de passe pour des raisons de sécurité
  }

  /// Retourne une représentation de la configuration (sans le mot de passe)
  @override
  String toString() {
    return 'DatabaseConfig(host: $host, port: $port, database: $database, username: $username, ssl: $useSsl)';
  }
}