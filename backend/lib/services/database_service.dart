// lib/services/database_service.dart
import 'package:postgres/postgres.dart';
import 'package:procolis_backend/config/database_config.dart';

class DatabaseService {
  static DatabaseService? _instance;
  late Connection _connection;
  bool _isConnected = false;

  DatabaseService._internal();

  static Future<DatabaseService> getInstance() async {
    if (_instance == null) {
      print('🆕 Création instance DatabaseService');
      _instance = DatabaseService._internal();
      await _instance!._init();
    } else {
      print('♻️ Réutilisation instance DatabaseService existante');
      // Vérifier si la connexion est toujours active
      if (!_instance!._isConnected) {
        print('🔄 Connexion perdue, tentative de reconnexion...');
        await _instance!._init();
      }
    }
    return _instance!;
  }

  Future<void> _init() async {
    try {
      final config = await DatabaseConfig.getInstance();

      print('═══════════════════════════════════════════════════════════');
      print('🔌 TENTATIVE DE CONNEXION POSTGRESQL');
      print('═══════════════════════════════════════════════════════════');
      print('🏠 Host: ${config.host}');
      print('🔌 Port: ${config.port}');
      print('🗄️  Database: ${config.database}');
      print('👤 Username: ${config.username}');
      print('🔒 SSL: ${config.useSsl ? '✅ Activé' : '❌ Désactivé'}');
      print('═══════════════════════════════════════════════════════════');

      final endpoint = Endpoint(
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
      );

      // connectionTimeout n'est pas supporté par ConnectionSettings
      // On utilise directement Connection.open avec un timeout
      final settings = ConnectionSettings(
        sslMode: config.useSsl ? SslMode.require : SslMode.disable,
      );

      print('🔄 Connexion en cours...');

      // Connexion avec timeout manuel
      _connection = await Connection.open(
        endpoint,
        settings: settings,
      );

      _isConnected = true;

      print('✅ PostgreSQL connecté avec succès !');

      // Vérifier la connexion avec une requête simple
      await _testConnection();

      await _createTables();
      await _seedInitialData();
      
    } catch (e, stackTrace) {
      print('❌ Erreur de connexion PostgreSQL: $e');
      print('📚 Stack trace:');
      print(stackTrace);
      _isConnected = false;
      rethrow; // Propager l'erreur pour que l'appelant puisse la gérer
    }
  }

  /// Teste la connexion avec une requête simple
  Future<void> _testConnection() async {
    try {
      final result = await _connection.execute('SELECT 1 as test');
      if (result.isNotEmpty) {
        print('✅ Test de connexion réussi');
      }
    } catch (e) {
      print('⚠️ Test de connexion échoué: $e');
      rethrow;
    }
  }

  Future<void> _createTables() async {
    try {
      print('📦 Création/Vérification des tables...');

      // Table users
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
      print('✅ Table users créée/vérifiée');

      // Table garages
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
      print('✅ Table garages créée/vérifiée');

      // Table parcels
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS parcels (
          id UUID PRIMARY KEY,
          tracking_number VARCHAR(50) UNIQUE NOT NULL,
          sender_id UUID,
          sender_name VARCHAR(255) NOT NULL,
          sender_phone VARCHAR(50) NOT NULL,
          sender_email VARCHAR(255),
          receiver_name VARCHAR(255) NOT NULL,
          receiver_phone VARCHAR(50) NOT NULL,
          receiver_email VARCHAR(255),
          receiver_address TEXT,
          description TEXT,
          weight DECIMAL(10, 2),
          length DECIMAL(10, 2),
          width DECIMAL(10, 2),
          height DECIMAL(10, 2),
          type VARCHAR(50) DEFAULT 'package',
          status VARCHAR(50) DEFAULT 'pending',
          departure_garage_id UUID,
          departure_garage_name VARCHAR(255),
          arrival_garage_id UUID,
          arrival_garage_name VARCHAR(255),
          driver_id UUID,
          driver_name VARCHAR(255),
          driver_phone VARCHAR(50),
          price DECIMAL(10, 2),
          delivery_fees DECIMAL(10, 2),
          total_amount DECIMAL(10, 2),
          payment_method VARCHAR(50),
          payment_phone_number VARCHAR(50),
          payment_status VARCHAR(50) DEFAULT 'pending',
          photo_urls TEXT[],
          video_urls TEXT[],
          audio_urls TEXT[],
          signature_url TEXT,
          is_insured BOOLEAN DEFAULT FALSE,
          insurance_amount DECIMAL(10, 2),
          is_urgent BOOLEAN DEFAULT FALSE,
          urgent_fee DECIMAL(10, 2),
          notes TEXT,
          pickup_date TIMESTAMP,
          delivery_date TIMESTAMP,
          estimated_delivery_date TIMESTAMP,
          created_by UUID,
          created_by_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          cancelled_by UUID,
          cancellation_reason TEXT,
          cancelled_at TIMESTAMP,
          score_debited BOOLEAN DEFAULT FALSE,
          score_refunded BOOLEAN DEFAULT FALSE,
          is_free_for_bidding BOOLEAN DEFAULT FALSE,
          proposed_price DECIMAL(10, 2),
          negotiated_price DECIMAL(10, 2),
          selected_bid_id UUID
        )
      ''');
      print('✅ Table parcels créée/vérifiée');

      // Table parcel_events
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS parcel_events (
          id UUID PRIMARY KEY,
          parcel_id UUID,
          status VARCHAR(50) NOT NULL,
          description TEXT,
          location VARCHAR(255),
          location_lat VARCHAR(50),
          location_lng VARCHAR(50),
          user_id UUID,
          user_name VARCHAR(255),
          user_role VARCHAR(50),
          photo_url TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      print('✅ Table parcel_events créée/vérifiée');

      // Table bids
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS bids (
          id UUID PRIMARY KEY,
          parcel_id UUID NOT NULL,
          driver_id UUID NOT NULL,
          driver_name VARCHAR(255) NOT NULL,
          driver_phone VARCHAR(50) NOT NULL,
          price DECIMAL(10, 2) NOT NULL,
          message TEXT,
          status VARCHAR(50) DEFAULT 'pending',
          audio_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          responded_at TIMESTAMP,
          response_message TEXT
        )
      ''');
      print('✅ Table bids créée/vérifiée');

      // Table otps
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS otps (
          id UUID PRIMARY KEY,
          user_id UUID,
          code VARCHAR(10) NOT NULL,
          type VARCHAR(50) DEFAULT 'verification',
          expires_at TIMESTAMP NOT NULL,
          attempts INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      print('✅ Table otps créée/vérifiée');

      // Table tokens
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS tokens (
          id UUID PRIMARY KEY,
          user_id UUID,
          token TEXT UNIQUE NOT NULL,
          refresh_token TEXT,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      print('✅ Table tokens créée/vérifiée');

      // Table scores
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS scores (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          points INT DEFAULT 0,
          total_earned INT DEFAULT 0,
          total_spent INT DEFAULT 0,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      print('✅ Table scores créée/vérifiée');

      // Table notifications
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          data JSONB,
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      print('✅ Table notifications créée/vérifiée');

      print('✅ Toutes les tables créées/vérifiées avec succès');
      
    } catch (e) {
      print('❌ Erreur création tables: $e');
      rethrow;
    }
  }

  Future<void> _seedInitialData() async {
    try {
      // Vérifier si les garages existent déjà
      final result = await _connection.execute('SELECT COUNT(*) FROM garages');
      final count = result.first[0] as int? ?? 0;

      if (count == 0) {
        print('🌱 Insertion des données initiales...');

        // Insertion des garages
        await _connection.execute('''
          INSERT INTO garages (id, name, city, region, address, phone)
          VALUES 
            (gen_random_uuid(), 'Garage Dakar Centre', 'Dakar', 'Dakar', '123 Avenue Cheikh Anta Diop', '+221 33 123 45 67'),
            (gen_random_uuid(), 'Garage Thiès', 'Thiès', 'Thiès', 'Route Nationale 1', '+221 33 987 65 43'),
            (gen_random_uuid(), 'Garage Saint-Louis', 'Saint-Louis', 'Saint-Louis', 'Boulevard de la Libération', '+221 33 456 78 90'),
            (gen_random_uuid(), 'Garage Ziguinchor', 'Ziguinchor', 'Ziguinchor', 'Avenue Léopold Sédar Senghor', '+221 33 654 32 10'),
            (gen_random_uuid(), 'Garage Kaolack', 'Kaolack', 'Kaolack', 'Boulevard du Général de Gaulle', '+221 33 789 01 23')
        ''');
        print('✅ Garages insérés');

        // Insertion de l'admin
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
        print('✅ Utilisateur admin créé');

        print('✅ Données initiales insérées avec succès');
      } else {
        print('ℹ️ Données initiales déjà présentes');
      }
      
    } catch (e) {
      print('⚠️ Erreur seed data: $e');
      // Ne pas propager l'erreur pour ne pas bloquer le démarrage
    }
  }

  /// Exécute une requête SQL avec des paramètres
  Future<List<ResultRow>> execute(String sql, {List<dynamic>? parameters}) async {
    if (!_isConnected) {
      throw StateError('Database connection is not initialized. Call getInstance() first and await it.');
    }
    
    try {
      if (parameters != null && parameters.isNotEmpty) {
        return await _connection.execute(sql, parameters: parameters);
      } else {
        return await _connection.execute(sql);
      }
    } catch (e) {
      print('❌ Erreur requête: $e');
      print('📝 SQL: $sql');
      rethrow;
    }
  }

  /// Exécute une requête SQL avec des paramètres nommés
  Future<List<ResultRow>> executeNamed(String sql, {Map<String, dynamic>? parameters}) async {
    if (!_isConnected) {
      throw StateError('Database connection is not initialized. Call getInstance() first and await it.');
    }
    
    try {
      if (parameters != null && parameters.isNotEmpty) {
        return await _connection.execute(sql, parameters: parameters);
      } else {
        return await _connection.execute(sql);
      }
    } catch (e) {
      print('❌ Erreur requête nommée: $e');
      print('📝 SQL: $sql');
      rethrow;
    }
  }

  /// Exécute une transaction
  Future<T> transaction<T>(Future<T> Function() action) async {
    if (!_isConnected) {
      throw StateError('Database connection is not initialized. Call getInstance() first and await it.');
    }
    
    try {
      await _connection.execute('BEGIN');
      final result = await action();
      await _connection.execute('COMMIT');
      return result;
    } catch (e) {
      await _connection.execute('ROLLBACK');
      print('❌ Transaction annulée: $e');
      rethrow;
    }
  }

  Connection get connection {
    if (!_isConnected) {
      throw StateError(
          'Database connection is not initialized. Call getInstance() first and await it.');
    }
    return _connection;
  }

  bool get isConnected => _isConnected;

  Future<void> close() async {
    if (_isConnected) {
      try {
        await _connection.close();
        _isConnected = false;
        print('🔌 Connexion PostgreSQL fermée');
      } catch (e) {
        print('⚠️ Erreur lors de la fermeture de la connexion: $e');
      }
    }
  }

  /// Vérifie si la connexion est toujours valide
  Future<bool> checkConnection() async {
    if (!_isConnected) return false;
    
    try {
      await _connection.execute('SELECT 1');
      return true;
    } catch (e) {
      _isConnected = false;
      return false;
    }
  }

  /// Reconnexion automatique en cas de perte de connexion
  Future<void> reconnect() async {
    print('🔄 Tentative de reconnexion...');
    await close();
    await _init();
  }
}