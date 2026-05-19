import 'package:dotenv/dotenv.dart';
import 'package:postgres/postgres.dart';

class DatabaseService {
  static DatabaseService? _instance;
  late final Connection _connection;
  bool _isConnected = false;

  DatabaseService._internal();

  static Future<DatabaseService> getInstance() async {
    if (_instance == null) {
      _instance = DatabaseService._internal();
      await _instance!._init();
    }
    return _instance!;
  }

  Future<void> _init() async {
    var env = DotEnv(includePlatformEnvironment: true)..load();

    final host = env['DB_HOST'] ?? 'localhost';
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
          sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
          sender_name VARCHAR(255) NOT NULL,
          sender_phone VARCHAR(50) NOT NULL,
          receiver_name VARCHAR(255) NOT NULL,
          receiver_phone VARCHAR(50) NOT NULL,
          receiver_email VARCHAR(255),
          description TEXT,
          weight DECIMAL(10, 2),
          type VARCHAR(50) DEFAULT 'package',
          status VARCHAR(50) DEFAULT 'pending',
          departure_garage_id UUID REFERENCES garages(id),
          departure_garage_name VARCHAR(255),
          arrival_garage_id UUID REFERENCES garages(id),
          arrival_garage_name VARCHAR(255),
          driver_id UUID REFERENCES users(id),
          driver_name VARCHAR(255),
          driver_phone VARCHAR(50),
          price DECIMAL(10, 2),
          payment_method VARCHAR(50),
          payment_status VARCHAR(50) DEFAULT 'pending',
          photo_urls TEXT[],
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
          user_id UUID REFERENCES users(id),
          user_name VARCHAR(255),
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      ''');
      
      // Table des OTP
      await _connection.execute('''
        CREATE TABLE IF NOT EXISTS otps (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id),
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
          user_id UUID REFERENCES users(id),
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

  // ==================== UTILISATEURS ====================
  
  Future<List<Map<String, dynamic>>> getAllUsers() async {
    final result = await _connection.execute('''
      SELECT id, email, phone, full_name, role, status, address, city, region, 
             vehicle_plate, vehicle_model, driver_status, pin, gender, garage_id,
             profile_photo, is_email_verified, is_phone_verified, created_at, updated_at, last_login
      FROM users ORDER BY created_at DESC
    ''');
    
    return result.map((row) => {
      'id': row[0],
      'email': row[1],
      'phone': row[2],
      'full_name': row[3],
      'role': row[4],
      'status': row[5],
      'address': row[6],
      'city': row[7],
      'region': row[8],
      'vehicle_plate': row[9],
      'vehicle_model': row[10],
      'driver_status': row[11],
      'pin': row[12],
      'gender': row[13],
      'garage_id': row[14],
      'profile_photo': row[15],
      'is_email_verified': row[16],
      'is_phone_verified': row[17],
      'created_at': row[18],
      'updated_at': row[19],
      'last_login': row[20],
    }).toList();
  }

  Future<Map<String, dynamic>?> getUserById(String id) async {
    final result = await _connection.execute(
      'SELECT * FROM users WHERE id = \$1',
      parameters: [id],
    );
    
    if (result.isEmpty) return null;
    
    final row = result.first;
    return {
      'id': row[0],
      'email': row[1],
      'phone': row[2],
      'full_name': row[3],
      'role': row[4],
      'status': row[5],
      'address': row[6],
      'city': row[7],
      'region': row[8],
      'vehicle_plate': row[9],
      'vehicle_model': row[10],
      'driver_status': row[11],
      'pin': row[12],
      'gender': row[13],
      'garage_id': row[14],
      'profile_photo': row[15],
      'is_email_verified': row[16],
      'is_phone_verified': row[17],
      'created_at': row[18],
      'updated_at': row[19],
      'last_login': row[20],
    };
  }

  Future<void> createUser(Map<String, dynamic> user) async {
    await _connection.execute('''
      INSERT INTO users (id, email, phone, full_name, password_hash, role, status, 
                         address, city, region, vehicle_plate, vehicle_model, 
                         driver_status, pin, gender, garage_id, profile_photo,
                         is_email_verified, is_phone_verified, created_at, updated_at)
      VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, \$14, \$15, \$16, \$17, \$18, \$19, NOW(), NOW())
    ''', parameters: [
      user['id'], user['email'], user['phone'], user['full_name'], user['password_hash'],
      user['role'] ?? 'client', user['status'] ?? 'active', user['address'], user['city'],
      user['region'], user['vehicle_plate'], user['vehicle_model'], user['driver_status'],
      user['pin'], user['gender'], user['garage_id'], user['profile_photo'],
      user['is_email_verified'] ?? false, user['is_phone_verified'] ?? false,
    ]);
  }

  Future<void> updateUser(String id, Map<String, dynamic> data) async {
    await _connection.execute('''
      UPDATE users SET 
        email = \$2, phone = \$3, full_name = \$4, role = \$5, status = \$6,
        address = \$7, city = \$8, region = \$9, vehicle_plate = \$10, 
        vehicle_model = \$11, driver_status = \$12, pin = \$13, gender = \$14,
        garage_id = \$15, updated_at = NOW()
      WHERE id = \$1
    ''', parameters: [
      id, data['email'], data['phone'], data['full_name'], data['role'],
      data['status'], data['address'], data['city'], data['region'],
      data['vehicle_plate'], data['vehicle_model'], data['driver_status'],
      data['pin'], data['gender'], data['garage_id'],
    ]);
  }

  Future<void> deleteUser(String id) async {
    await _connection.execute('DELETE FROM users WHERE id = \$1', parameters: [id]);
  }

  Future<void> updateUserStatus(String id, String status) async {
    await _connection.execute(
      'UPDATE users SET status = \$2, updated_at = NOW() WHERE id = \$1',
      parameters: [id, status],
    );
  }

  Future<void> updateUserPin(String id, String pin) async {
    await _connection.execute(
      'UPDATE users SET pin = \$2, updated_at = NOW() WHERE id = \$1',
      parameters: [id, pin],
    );
  }

  // ==================== GARAGES ====================
  
  Future<List<Map<String, dynamic>>> getAllGarages() async {
    final result = await _connection.execute('''
      SELECT id, name, city, region, address, phone, latitude, longitude, 
             drivers_count, parcels_count, revenue, created_at, updated_at
      FROM garages ORDER BY created_at DESC
    ''');
    
    return result.map((row) => {
      'id': row[0],
      'name': row[1],
      'city': row[2],
      'region': row[3],
      'address': row[4],
      'phone': row[5],
      'latitude': row[6],
      'longitude': row[7],
      'drivers_count': row[8],
      'parcels_count': row[9],
      'revenue': row[10],
      'created_at': row[11],
      'updated_at': row[12],
    }).toList();
  }

  Future<Map<String, dynamic>?> getGarageById(String id) async {
    final result = await _connection.execute(
      'SELECT * FROM garages WHERE id = \$1',
      parameters: [id],
    );
    
    if (result.isEmpty) return null;
    
    final row = result.first;
    return {
      'id': row[0],
      'name': row[1],
      'city': row[2],
      'region': row[3],
      'address': row[4],
      'phone': row[5],
      'latitude': row[6],
      'longitude': row[7],
      'drivers_count': row[8],
      'parcels_count': row[9],
      'revenue': row[10],
      'created_at': row[11],
      'updated_at': row[12],
    };
  }

  Future<void> createGarage(Map<String, dynamic> garage) async {
    await _connection.execute('''
      INSERT INTO garages (id, name, city, region, address, phone, latitude, longitude, 
                           drivers_count, parcels_count, revenue, created_at, updated_at)
      VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, NOW(), NOW())
    ''', parameters: [
      garage['id'], garage['name'], garage['city'], garage['region'], garage['address'],
      garage['phone'], garage['latitude'], garage['longitude'],
      garage['drivers_count'] ?? 0, garage['parcels_count'] ?? 0, garage['revenue'] ?? 0,
    ]);
  }

  Future<void> updateGarage(String id, Map<String, dynamic> data) async {
    await _connection.execute('''
      UPDATE garages SET 
        name = \$2, city = \$3, region = \$4, address = \$5, phone = \$6,
        latitude = \$7, longitude = \$8, updated_at = NOW()
      WHERE id = \$1
    ''', parameters: [
      id, data['name'], data['city'], data['region'], data['address'],
      data['phone'], data['latitude'], data['longitude'],
    ]);
  }

  Future<void> deleteGarage(String id) async {
    await _connection.execute('DELETE FROM garages WHERE id = \$1', parameters: [id]);
  }

  // ==================== COLIS ====================
  
  Future<List<Map<String, dynamic>>> getAllParcels() async {
    final result = await _connection.execute('''
      SELECT * FROM parcels ORDER BY created_at DESC
    ''');
    
    return result.map((row) => {
      'id': row[0],
      'tracking_number': row[1],
      'sender_id': row[2],
      'sender_name': row[3],
      'sender_phone': row[4],
      'receiver_name': row[5],
      'receiver_phone': row[6],
      'receiver_email': row[7],
      'description': row[8],
      'weight': row[9],
      'type': row[10],
      'status': row[11],
      'departure_garage_id': row[12],
      'departure_garage_name': row[13],
      'arrival_garage_id': row[14],
      'arrival_garage_name': row[15],
      'driver_id': row[16],
      'driver_name': row[17],
      'driver_phone': row[18],
      'price': row[19],
      'payment_method': row[20],
      'payment_status': row[21],
      'photo_urls': row[22],
      'signature_url': row[23],
      'pickup_date': row[24],
      'delivery_date': row[25],
      'created_at': row[26],
      'updated_at': row[27],
    }).toList();
  }

  Future<Map<String, dynamic>?> getParcelById(String id) async {
    final result = await _connection.execute(
      'SELECT * FROM parcels WHERE id = \$1',
      parameters: [id],
    );
    
    if (result.isEmpty) return null;
    final row = result.first;
    return {
      'id': row[0],
      'tracking_number': row[1],
      'sender_id': row[2],
      'sender_name': row[3],
      'sender_phone': row[4],
      'receiver_name': row[5],
      'receiver_phone': row[6],
      'receiver_email': row[7],
      'description': row[8],
      'weight': row[9],
      'type': row[10],
      'status': row[11],
      'departure_garage_id': row[12],
      'departure_garage_name': row[13],
      'arrival_garage_id': row[14],
      'arrival_garage_name': row[15],
      'driver_id': row[16],
      'driver_name': row[17],
      'driver_phone': row[18],
      'price': row[19],
      'payment_method': row[20],
      'payment_status': row[21],
      'photo_urls': row[22],
      'signature_url': row[23],
      'pickup_date': row[24],
      'delivery_date': row[25],
      'created_at': row[26],
      'updated_at': row[27],
    };
  }

  Future<void> createParcel(Map<String, dynamic> parcel) async {
    await _connection.execute('''
      INSERT INTO parcels (id, tracking_number, sender_id, sender_name, sender_phone,
                           receiver_name, receiver_phone, receiver_email, description, weight,
                           type, status, departure_garage_id, departure_garage_name,
                           arrival_garage_id, arrival_garage_name, driver_id, driver_name,
                           driver_phone, price, payment_method, payment_status,
                           photo_urls, signature_url, pickup_date, delivery_date,
                           created_at, updated_at)
      VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, \$14,
              \$15, \$16, \$17, \$18, \$19, \$20, \$21, \$22, \$23, \$24, \$25, \$26, NOW(), NOW())
    ''', parameters: [
      parcel['id'], parcel['tracking_number'], parcel['sender_id'], parcel['sender_name'],
      parcel['sender_phone'], parcel['receiver_name'], parcel['receiver_phone'],
      parcel['receiver_email'], parcel['description'], parcel['weight'], parcel['type'],
      parcel['status'], parcel['departure_garage_id'], parcel['departure_garage_name'],
      parcel['arrival_garage_id'], parcel['arrival_garage_name'], parcel['driver_id'],
      parcel['driver_name'], parcel['driver_phone'], parcel['price'], parcel['payment_method'],
      parcel['payment_status'], parcel['photo_urls'], parcel['signature_url'],
      parcel['pickup_date'], parcel['delivery_date'],
    ]);
  }

  Future<void> updateParcelStatus(String id, String status, {String? location}) async {
    await _connection.execute('''
      UPDATE parcels SET status = \$2, updated_at = NOW() WHERE id = \$1
    ''', parameters: [id, status]);
  }

  Future<void> deleteParcel(String id) async {
    await _connection.execute('DELETE FROM parcels WHERE id = \$1', parameters: [id]);
  }

  // ==================== OTP ====================
  
  Future<void> createOtp(Map<String, dynamic> otp) async {
    await _connection.execute('''
      INSERT INTO otps (id, user_id, code, type, expires_at, attempts, created_at)
      VALUES (\$1, \$2, \$3, \$4, \$5, \$6, NOW())
    ''', parameters: [
      otp['id'], otp['user_id'], otp['code'], otp['type'], otp['expires_at'], otp['attempts'] ?? 0,
    ]);
  }

  Future<Map<String, dynamic>?> getLatestOtpByUserId(String userId) async {
    final result = await _connection.execute('''
      SELECT code, expires_at, attempts FROM otps 
      WHERE user_id = \$1 
      ORDER BY created_at DESC 
      LIMIT 1
    ''', parameters: [userId]);
    
    if (result.isEmpty) return null;
    return {
      'code': result.first[0],
      'expires_at': result.first[1],
      'attempts': result.first[2],
    };
  }

  Future<void> updateOtpAttempts(String userId, int attempts) async {
    await _connection.execute(
      'UPDATE otps SET attempts = \$2 WHERE user_id = \$1',
      parameters: [userId, attempts],
    );
  }

  Future<void> deleteOtpsByUserId(String userId) async {
    await _connection.execute(
      'DELETE FROM otps WHERE user_id = \$1',
      parameters: [userId],
    );
  }

  // ==================== TOKENS ====================
  
  Future<void> createToken(Map<String, dynamic> token) async {
    await _connection.execute('''
      INSERT INTO tokens (id, user_id, token, refresh_token, expires_at, created_at)
      VALUES (\$1, \$2, \$3, \$4, \$5, NOW())
    ''', parameters: [
      token['id'], token['user_id'], token['token'], token['refresh_token'], token['expires_at'],
    ]);
  }

  Future<void> deleteTokenByUserId(String userId) async {
    await _connection.execute(
      'DELETE FROM tokens WHERE user_id = \$1',
      parameters: [userId],
    );
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