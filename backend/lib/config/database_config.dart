import 'package:dotenv/dotenv.dart';

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
    if (_instance == null) {
      _instance = DatabaseConfig._internal();
      await _instance!._loadConfig();
    }

    return _instance!;
  }

  Future<void> _loadConfig() async {
    final env = DotEnv(includePlatformEnvironment: true);

    try {
      env.load();
    } catch (_) {
      print('⚠️ Aucun fichier .env trouvé');
    }

    host = env['DB_HOST'] ?? 'localhost';

    port = int.parse(
      env['DB_PORT'] ?? '5432',
    );

    database = env['DB_NAME'] ?? 'procolis_db';

    username = env['DB_USER'] ?? 'postgres';

    password = env['DB_PASSWORD'] ?? '';

    useSsl = host != 'localhost' && host != '127.0.0.1';

    print('📋 Database Config Loaded');
    print('Host: $host');
    print('Port: $port');
    print('Database: $database');
    print('User: $username');
    print('SSL: $useSsl');
  }
}