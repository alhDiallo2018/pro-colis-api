-- migration_complete.sql
-- Migration complète pour PROCOLIS Database avec tous les modèles
-- Version corrigée pour Render PostgreSQL

-- ========================================
-- 1. SUPPRESSION DES TABLES EXISTANTES (optionnel)
-- ========================================
-- DROP TABLE IF EXISTS parcel_events CASCADE;
-- DROP TABLE IF EXISTS payments CASCADE;
-- DROP TABLE IF EXISTS parcels CASCADE;
-- DROP TABLE IF EXISTS garages CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;
-- DROP TABLE IF EXISTS otps CASCADE;
-- DROP TABLE IF EXISTS tokens CASCADE;

-- ========================================
-- 2. CRÉATION DES TABLES
-- ========================================

-- Table users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(50) DEFAULT 'client',
    pin VARCHAR(10),
    garage_id UUID,
    vehicle_plate VARCHAR(50),
    vehicle_model VARCHAR(100),
    vehicle_color VARCHAR(50),
    vehicle_year INTEGER,
    address TEXT,
    city VARCHAR(100),
    region VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Sénégal',
    driver_status VARCHAR(50) DEFAULT 'offline',
    profile_photo TEXT,
    status VARCHAR(50) DEFAULT 'active',
    is_email_verified BOOLEAN DEFAULT FALSE,
    is_phone_verified BOOLEAN DEFAULT FALSE,
    gender VARCHAR(20),
    birth_date DATE,
    national_id VARCHAR(100),
    emergency_contact VARCHAR(255),
    emergency_phone VARCHAR(50),
    fcm_token TEXT,
    is_approved BOOLEAN DEFAULT FALSE,
    approved_by UUID,
    approved_at TIMESTAMP,
    created_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    last_active TIMESTAMP
);

-- Table garages
CREATE TABLE IF NOT EXISTS garages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
);

-- Table parcels
CREATE TABLE IF NOT EXISTS parcels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_number VARCHAR(50) UNIQUE NOT NULL,
    sender_id UUID,
    sender_name VARCHAR(255) NOT NULL,
    sender_phone VARCHAR(50) NOT NULL,
    sender_email VARCHAR(255),
    receiver_name VARCHAR(255) NOT NULL,
    receiver_phone VARCHAR(50) NOT NULL,
    receiver_email VARCHAR(255),
    receiver_address TEXT,
    description TEXT NOT NULL,
    weight DECIMAL(10, 2) NOT NULL,
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
    payment_status VARCHAR(50) DEFAULT 'pending',
    payment_phone_number VARCHAR(50),
    photo_urls TEXT[] DEFAULT '{}',
    video_urls TEXT[] DEFAULT '{}',
    signature_url TEXT,
    is_insured BOOLEAN DEFAULT FALSE,
    insurance_amount DECIMAL(10, 2),
    is_urgent BOOLEAN DEFAULT FALSE,
    urgent_fee DECIMAL(10, 2),
    notes TEXT,
    pickup_date TIMESTAMP,
    delivery_date TIMESTAMP,
    estimated_delivery_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    cancelled_by UUID,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMP
);

-- Table parcel_events
CREATE TABLE IF NOT EXISTS parcel_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parcel_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(255),
    location_lat VARCHAR(50),
    location_lng VARCHAR(50),
    user_id UUID,
    user_name VARCHAR(255),
    user_role VARCHAR(50),
    photo_url TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table payments
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    parcel_id UUID,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'XOF',
    method VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    transaction_id VARCHAR(255) UNIQUE,
    phone_number VARCHAR(50),
    reference VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Table otps
CREATE TABLE IF NOT EXISTS otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    code VARCHAR(10) NOT NULL,
    type VARCHAR(50) DEFAULT 'verification',
    expires_at TIMESTAMP NOT NULL,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table tokens
CREATE TABLE IF NOT EXISTS tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token TEXT UNIQUE NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 3. CRÉATION DES INDEX
-- ========================================

-- Index pour users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_garage ON users(garage_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_driver_status ON users(driver_status);

-- Index pour garages
CREATE INDEX IF NOT EXISTS idx_garages_city ON garages(city);
CREATE INDEX IF NOT EXISTS idx_garages_region ON garages(region);

-- Index pour parcels
CREATE INDEX IF NOT EXISTS idx_parcels_tracking ON parcels(tracking_number);
CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcels_sender ON parcels(sender_id);
CREATE INDEX IF NOT EXISTS idx_parcels_driver ON parcels(driver_id);
CREATE INDEX IF NOT EXISTS idx_parcels_departure_garage ON parcels(departure_garage_id);
CREATE INDEX IF NOT EXISTS idx_parcels_arrival_garage ON parcels(arrival_garage_id);
CREATE INDEX IF NOT EXISTS idx_parcels_created ON parcels(created_at);
CREATE INDEX IF NOT EXISTS idx_parcels_pickup_date ON parcels(pickup_date);
CREATE INDEX IF NOT EXISTS idx_parcels_type ON parcels(type);
CREATE INDEX IF NOT EXISTS idx_parcels_payment_status ON parcels(payment_status);

-- Index pour parcel_events
CREATE INDEX IF NOT EXISTS idx_events_parcel ON parcel_events(parcel_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON parcel_events(status);
CREATE INDEX IF NOT EXISTS idx_events_created ON parcel_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_user ON parcel_events(user_id);

-- Index pour payments
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_parcel ON payments(parcel_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

-- Index pour otps
CREATE INDEX IF NOT EXISTS idx_otps_user ON otps(user_id);
CREATE INDEX IF NOT EXISTS idx_otps_code ON otps(code);
CREATE INDEX IF NOT EXISTS idx_otps_expires ON otps(expires_at);

-- Index pour tokens
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_tokens_refresh ON tokens(refresh_token);

-- ========================================
-- 4. FONCTIONS ET TRIGGERS
-- ========================================

-- Fonction pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Triggers pour garages
DROP TRIGGER IF EXISTS update_garages_updated_at ON garages;
CREATE TRIGGER update_garages_updated_at
    BEFORE UPDATE ON garages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Triggers pour parcels
DROP TRIGGER IF EXISTS update_parcels_updated_at ON parcels;
CREATE TRIGGER update_parcels_updated_at
    BEFORE UPDATE ON parcels
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- 5. DONNÉES INITIALES
-- ========================================

-- Insertion des garages avec des UUIDs fixes pour faciliter la migration
INSERT INTO garages (id, name, city, region, address, phone)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'Garage Dakar Centre', 'Dakar', 'Dakar', '123 Avenue Cheikh Anta Diop', '+221 33 123 45 67'),
    ('22222222-2222-2222-2222-222222222222', 'Garage Thiès', 'Thiès', 'Thiès', 'Route Nationale 1', '+221 33 987 65 43'),
    ('33333333-3333-3333-3333-333333333333', 'Garage Saint-Louis', 'Saint-Louis', 'Saint-Louis', 'Boulevard de la Libération', '+221 33 456 78 90'),
    ('44444444-4444-4444-4444-444444444444', 'Garage Ziguinchor', 'Ziguinchor', 'Ziguinchor', 'Avenue Léopold Sédar Senghor', '+221 33 654 32 10'),
    ('55555555-5555-5555-5555-555555555555', 'Garage Kaolack', 'Kaolack', 'Kaolack', 'Boulevard du Général de Gaulle', '+221 33 789 01 23')
ON CONFLICT (id) DO NOTHING;

-- Insertion du super admin
INSERT INTO users (
    id, email, phone, full_name, role, status, pin, 
    is_email_verified, is_phone_verified, created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@procolis.com', 
    '+221 77 123 45 67', 
    'Administrateur', 
    'super_admin', 
    'active', 
    '123456',
    TRUE,
    TRUE,
    NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Insertion d'un admin garage
INSERT INTO users (
    id, email, phone, full_name, role, status, pin, 
    garage_id, is_email_verified, is_phone_verified, created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'garage@procolis.com', 
    '+221 78 123 45 67', 
    'Admin Garage', 
    'admin', 
    'active', 
    '123456',
    '11111111-1111-1111-1111-111111111111',
    TRUE,
    TRUE,
    NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Insertion d'un chauffeur test
INSERT INTO users (
    id, email, phone, full_name, role, driver_status, status, 
    garage_id, pin, created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    'driver@procolis.com', 
    '+221 79 123 45 67', 
    'Chauffeur Test', 
    'driver', 
    'available', 
    'active',
    '11111111-1111-1111-1111-111111111111',
    '123456',
    NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Insertion d'un client test
INSERT INTO users (
    id, email, phone, full_name, role, status, pin, created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000004',
    'client@procolis.com', 
    '+221 70 123 45 67', 
    'Client Test', 
    'client', 
    'active', 
    '123456',
    NOW()
)
ON CONFLICT (email) DO NOTHING;

-- ========================================
-- 6. VÉRIFICATIONS
-- ========================================

-- Afficher les tables créées
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Compter les enregistrements
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'garages', COUNT(*) FROM garages
UNION ALL
SELECT 'parcels', COUNT(*) FROM parcels
UNION ALL
SELECT 'parcel_events', COUNT(*) FROM parcel_events
UNION ALL
SELECT 'payments', COUNT(*) FROM payments
UNION ALL
SELECT 'otps', COUNT(*) FROM otps
UNION ALL
SELECT 'tokens', COUNT(*) FROM tokens;

-- Afficher les utilisateurs créés
SELECT id, email, full_name, role, status FROM users;

-- Afficher les garages créés
SELECT id, name, city, region FROM garages;