// lib/utils/db_helper.dart
import 'package:dotenv/dotenv.dart';
import 'package:postgres/postgres.dart';

class DbHelper {
  static DbHelper? _instance;
  late Connection _connection;
  bool _isConnected = false;

  DbHelper._internal();

  static Future<DbHelper> getInstance() async {
    if (_instance == null) {
      _instance = DbHelper._internal();
      await _instance!._init();
    }
    return _instance!;
  }

  Future<void> _init() async {
    var env = DotEnv(includePlatformEnvironment: true)..load();

    final host = env['DB_HOST'];

    if (host == null || host.isEmpty || host == 'localhost') {
      throw Exception('❌ DB_HOST invalide ou manquant');
    }
    final port = int.parse(env['DB_PORT'] ?? '5432');
    final database = env['DB_NAME'] ?? 'procolis';
    final username = env['DB_USER'] ?? 'testad';
    final password = env['DB_PASSWORD'] ?? 'postgres';

    final endpoint = Endpoint(
      host: host,
      port: port,
      database: database,
      username: username,
      password: password,
    );

    final settings = ConnectionSettings(
      sslMode: SslMode.disable,
    );

    try {
      _connection = await Connection.open(endpoint, settings: settings);
      _isConnected = true;
      
      print('✅ Connecté à PostgreSQL sur $host:$port/$database');
      
      await _createTables();
      await _seedInitialData();
    } catch (e) {
      print('❌ Erreur de connexion à PostgreSQL: $e');
      rethrow;
    }
  }

  Future<void> _createTables() async {
    try {
      // Table des utilisateurs
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          phone VARCHAR(50) UNIQUE NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255),
          role VARCHAR(50) DEFAULT 'client',
          status VARCHAR(50) DEFAULT 'active',
          address TEXT,
          city VARCHAR(100),
          region VARCHAR(100),
          vehicle_plate VARCHAR(50),
          vehicle_model VARCHAR(100),
          driver_status VARCHAR(50),
          pin VARCHAR(10),
          gender VARCHAR(20),
          garage_id UUID,
          profile_photo TEXT,
          is_email_verified BOOLEAN DEFAULT FALSE,
          is_phone_verified BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP
        )
      ''');
      
      // Table des garages
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS garages (
          id UUID PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          city VARCHAR(100) NOT NULL,
          region VARCHAR(100) NOT NULL,
          address TEXT,
          phone VARCHAR(50),
          latitude DECIMAL(10, 8),
          longitude DECIMAL(11, 8),
          drivers_count INT DEFAULT 0,
          parcels_count INT DEFAULT 0,
          revenue DECIMAL(10, 2) DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      
      // Table des colis
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS parcels (
          id UUID PRIMARY KEY,
          tracking_number VARCHAR(50) UNIQUE NOT NULL,
          sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
          sender_name VARCHAR(255) NOT NULL,
          sender_phone VARCHAR(50) NOT NULL,
          receiver_name VARCHAR(255) NOT NULL,
          receiver_phone VARCHAR(50) NOT NULL,
          receiver_email VARCHAR(255),
          description TEXT,
          weight DECIMAL(10, 2),
          type VARCHAR(50) DEFAULT 'package',
          status VARCHAR(50) DEFAULT 'pending',
          departure_garage_id UUID REFERENCES garages(id) ON DELETE SET NULL,
          departure_garage_name VARCHAR(255),
          arrival_garage_id UUID REFERENCES garages(id) ON DELETE SET NULL,
          arrival_garage_name VARCHAR(255),
          driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
          driver_name VARCHAR(255),
          driver_phone VARCHAR(50),
          price DECIMAL(10, 2),
          payment_method VARCHAR(50),
          payment_status VARCHAR(50) DEFAULT 'pending',
          photo_urls TEXT[] DEFAULT '{}',
          signature_url TEXT,
          pickup_date TIMESTAMP,
          delivery_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      
      // Table des événements
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS parcel_events (
          id UUID PRIMARY KEY,
          parcel_id UUID REFERENCES parcels(id) ON DELETE CASCADE,
          status VARCHAR(50) NOT NULL,
          description TEXT,
          location VARCHAR(255),
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          user_name VARCHAR(255),
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      
      // Table des OTP
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS otps (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          code VARCHAR(10) NOT NULL,
          type VARCHAR(50) DEFAULT 'verification',
          expires_at TIMESTAMP NOT NULL,
          attempts INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      
      // Table des tokens
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS tokens (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          token TEXT UNIQUE NOT NULL,
          refresh_token TEXT,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      
      print('✅ Tables créées/vérifiées');
    } catch (e) {
      print('❌ Erreur lors de la création des tables: $e');
      rethrow;
    }
  }

  Future<void> _seedInitialData() async {
    try {
      final result = await _connection.execute('SELECT COUNT(*) FROM garages');
      final count = result.first[0];
      
      if (count == 0) {
        print('🌱 Insertion des données initiales...');
        
        await _connection.execute('''
          INSERT INTO garages (id, name, city, region, address, phone, drivers_count, parcels_count, revenue)
          VALUES 
            (gen_random_uuid(), 'Garage Dakar Centre', 'Dakar', 'Dakar', '123 Avenue Cheikh Anta Diop', '+221 33 123 45 67', 12, 234, 1250000),
            (gen_random_uuid(), 'Garage Thiès', 'Thiès', 'Thiès', 'Route Nationale 1', '+221 33 987 65 43', 8, 156, 890000),
            (gen_random_uuid(), 'Garage Saint-Louis', 'Saint-Louis', 'Saint-Louis', 'Boulevard de la Libération', '+221 33 456 78 90', 5, 98, 450000),
            (gen_random_uuid(), 'Garage Ziguinchor', 'Ziguinchor', 'Ziguinchor', 'Avenue Léopold Sédar Senghor', '+221 33 654 32 10', 6, 112, 678000),
            (gen_random_uuid(), 'Garage Kaolack', 'Kaolack', 'Kaolack', 'Boulevard du Général de Gaulle', '+221 33 789 01 23', 4, 87, 345000)
        ''');
        
        await _connection.execute('''
          INSERT INTO users (id, email, phone, full_name, role, status, pin, is_email_verified, is_phone_verified)
          VALUES (
            gen_random_uuid(), 
            'admin@procolis.com', 
            '+221 77 123 45 67', 
            'Administrateur', 
            'super_admin', 
            'active', 
            '123456',
            TRUE,
            TRUE
          )
        ''');
        
        print('✅ Données initiales insérées (5 garages, 1 admin)');
        print('📝 Admin: admin@procolis.com / PIN: 123456');
      }
    } catch (e) {
      print('❌ Erreur lors de l\'insertion des données initiales: $e');
    }
  }

  Connection get connection {
    if (!_isConnected) {
      throw StateError('Database connection is not initialized. Call getInstance() first and await it.');
    }
    return _connection;
  }
  
  bool get isConnected => _isConnected;
  
  Future<void> close() async {
    if (_isConnected) {
      await _connection.close();
      _isConnected = false;
      print('🔌 Déconnexion PostgreSQL');
    }
  }
}
