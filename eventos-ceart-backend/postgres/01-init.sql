-- ===== EXTENSIONES =====
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ===== TABLAS =====
CREATE TABLE IF NOT EXISTS venues (
    id   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    title text NOT NULL,
    summary text,
    description text NOT NULL,
    category text,
    tags text[],
    venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
    start_at timestamptz NOT NULL,
    end_at   timestamptz NOT NULL,
    capacity_total int DEFAULT 0,
    capacity_reserved int DEFAULT 0,
    status text NOT NULL DEFAULT 'scheduled',
    search_vector tsvector,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_images (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    url text NOT NULL,
    alt text,
    position int NOT NULL DEFAULT 1,
    is_cover boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name text NOT NULL,
    email text NOT NULL,
    phone text,
    qty int NOT NULL DEFAULT 1,
    notes text,
    status text NOT NULL DEFAULT 'confirmed',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===== ÍNDICES =====
-- Índices para events
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_end ON events(end_at);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_venue ON events(venue_id);
CREATE INDEX IF NOT EXISTS idx_events_search_gin ON events USING GIN (search_vector);

-- Índices para event_images
CREATE INDEX IF NOT EXISTS idx_event_images_event ON event_images(event_id);
CREATE INDEX IF NOT EXISTS idx_event_images_event_pos ON event_images(event_id, position);
CREATE INDEX IF NOT EXISTS idx_event_images_cover ON event_images(event_id) WHERE is_cover = true;

-- Índices para bookings
CREATE INDEX IF NOT EXISTS idx_bookings_event ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC);

-- ===== ÍNDICES ÚNICOS =====
-- Solo una portada por evento
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cover_per_event 
ON event_images (event_id) 
WHERE is_cover = true;

-- Prevenir reservas duplicadas del mismo email para el mismo evento
CREATE UNIQUE INDEX IF NOT EXISTS uniq_booking_event_email 
ON bookings (event_id, email) 
WHERE status = 'confirmed';

-- ===== TRIGGERS Y FUNCIONES =====
-- Trigger para search_vector en events
CREATE OR REPLACE FUNCTION events_search_vector_update() 
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.title, ''))), 'A') ||
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.summary, ''))), 'B') ||
        setweight(to_tsvector('spanish', unaccent(coalesce(NEW.description, ''))), 'C');
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_search_vector ON events;
CREATE TRIGGER trg_events_search_vector
    BEFORE INSERT OR UPDATE OF title, summary, description
    ON events
    FOR EACH ROW
    EXECUTE FUNCTION events_search_vector_update();

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_venues_updated_at ON venues;
CREATE TRIGGER update_venues_updated_at
    BEFORE UPDATE ON venues
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_images_updated_at ON event_images;
CREATE TRIGGER update_event_images_updated_at
    BEFORE UPDATE ON event_images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Función para actualizar capacity_reserved automáticamente
CREATE OR REPLACE FUNCTION update_event_capacity_reserved()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalcular capacity_reserved cuando cambian las reservas
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        UPDATE events 
        SET capacity_reserved = (
            SELECT COALESCE(SUM(qty), 0)
            FROM bookings 
            WHERE event_id = COALESCE(NEW.event_id, OLD.event_id)
            AND status = 'confirmed'
        ),
        updated_at = NOW()
        WHERE id = COALESCE(NEW.event_id, OLD.event_id);
        
        -- Actualizar status a 'soldout' si está lleno
        UPDATE events 
        SET status = 'soldout',
            updated_at = NOW()
        WHERE id = COALESCE(NEW.event_id, OLD.event_id)
        AND capacity_total > 0
        AND capacity_total <= (
            SELECT COALESCE(SUM(qty), 0)
            FROM bookings 
            WHERE event_id = COALESCE(NEW.event_id, OLD.event_id)
            AND status = 'confirmed'
        );
        
        -- Actualizar status a 'scheduled' si ya no está lleno
        UPDATE events 
        SET status = 'scheduled',
            updated_at = NOW()
        WHERE id = COALESCE(NEW.event_id, OLD.event_id)
        AND status = 'soldout'
        AND capacity_total > (
            SELECT COALESCE(SUM(qty), 0)
            FROM bookings 
            WHERE event_id = COALESCE(NEW.event_id, OLD.event_id)
            AND status = 'confirmed'
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualizar capacity_reserved automáticamente
DROP TRIGGER IF EXISTS update_capacity_on_booking_insert ON bookings;
CREATE TRIGGER update_capacity_on_booking_insert
    AFTER INSERT ON bookings
    FOR EACH ROW
    WHEN (NEW.status = 'confirmed')
    EXECUTE FUNCTION update_event_capacity_reserved();

DROP TRIGGER IF EXISTS update_capacity_on_booking_update ON bookings;
CREATE TRIGGER update_capacity_on_booking_update
    AFTER UPDATE ON bookings
    FOR EACH ROW
    WHEN (OLD.status != NEW.status OR OLD.qty != NEW.qty)
    EXECUTE FUNCTION update_event_capacity_reserved();

DROP TRIGGER IF EXISTS update_capacity_on_booking_delete ON bookings;
CREATE TRIGGER update_capacity_on_booking_delete
    AFTER DELETE ON bookings
    FOR EACH ROW
    WHEN (OLD.status = 'confirmed')
    EXECUTE FUNCTION update_event_capacity_reserved();

-- ===== DATOS INICIALES =====
-- Sedes iniciales
INSERT INTO venues (name) VALUES 
    ('Sala Principal'),
    ('Sala Experimental'),
    ('Teatro al Aire Libre'),
    ('Galería de Arte'),
    ('Auditorio Central'),
    ('Sala de Conferencias'),
    ('Patio Interior'),
    ('Plaza Central')
ON CONFLICT (name) DO NOTHING;

-- Eventos de ejemplo
INSERT INTO events (title, summary, description, category, venue_id, start_at, end_at, capacity_total) 
SELECT 
    'Concierto de Música Clásica',
    'Una noche de música clásica con la Orquesta Sinfónica',
    'Disfruta de una velada inolvidable con las mejores piezas de música clásica interpretadas por la renombrada Orquesta Sinfónica. Programa incluye obras de Mozart, Beethoven y Bach.',
    'concierto',
    id,
    NOW() + INTERVAL '7 days',
    NOW() + INTERVAL '7 days' + INTERVAL '3 hours',
    100
FROM venues WHERE name = 'Sala Principal'
ON CONFLICT DO NOTHING;

INSERT INTO events (title, summary, description, category, venue_id, start_at, end_at, capacity_total) 
SELECT 
    'Taller de Pintura al Óleo',
    'Aprende las técnicas básicas de pintura al óleo',
    'Taller introductorio para principiantes que deseen aprender las técnicas fundamentales de la pintura al óleo. Todos los materiales incluidos.',
    'taller',
    id,
    NOW() + INTERVAL '3 days',
    NOW() + INTERVAL '3 days' + INTERVAL '2 hours',
    20
FROM venues WHERE name = 'Galería de Arte'
ON CONFLICT DO NOTHING;

INSERT INTO events (title, summary, description, category, venue_id, start_at, end_at, capacity_total) 
SELECT 
    'Obra de Teatro: El Jardín de los Cerezos',
    'Adaptación moderna de la obra clásica de Chéjov',
    'Una puesta en escena contemporánea de la obra maestra de Antón Chéjov, dirigida por el premiado director Marco Flores.',
    'teatro',
    id,
    NOW() + INTERVAL '14 days',
    NOW() + INTERVAL '14 days' + INTERVAL '2 hours',
    150
FROM venues WHERE name = 'Teatro al Aire Libre'
ON CONFLICT DO NOTHING;

-- Reservas de ejemplo
INSERT INTO bookings (event_id, name, email, phone, qty, notes) 
SELECT 
    e.id,
    'María González',
    'maria.gonzalez@email.com',
    '+52 55 1234 5678',
    2,
    'Asientos preferentes si es posible'
FROM events e 
WHERE e.title = 'Concierto de Música Clásica'
ON CONFLICT DO NOTHING;

INSERT INTO bookings (event_id, name, email, phone, qty) 
SELECT 
    e.id,
    'Carlos Rodríguez',
    'carlos.rodriguez@email.com',
    '+52 55 8765 4321',
    4
FROM events e 
WHERE e.title = 'Concierto de Música Clásica'
ON CONFLICT DO NOTHING;

INSERT INTO bookings (event_id, name, email, qty, notes) 
SELECT 
    e.id,
    'Ana Martínez',
    'ana.martinez@email.com',
    1,
    'Principiante en pintura'
FROM events e 
WHERE e.title = 'Taller de Pintura al Óleo'
ON CONFLICT DO NOTHING;

-- ===== VISTAS ÚTILES =====
-- Vista para disponibilidad de eventos
CREATE OR REPLACE VIEW events_availability AS
SELECT 
    e.*,
    v.name as venue_name,
    COALESCE(SUM(b.qty) FILTER (WHERE b.status = 'confirmed'), 0) as reserved_qty,
    GREATEST(0, e.capacity_total - COALESCE(SUM(b.qty) FILTER (WHERE b.status = 'confirmed'), 0)) as available_qty,
    (e.capacity_total - COALESCE(SUM(b.qty) FILTER (WHERE b.status = 'confirmed'), 0)) <= 0 as is_sold_out
FROM events e
LEFT JOIN venues v ON v.id = e.venue_id
LEFT JOIN bookings b ON b.event_id = e.id
GROUP BY e.id, v.name;

-- Vista para reportes de reservas
CREATE OR REPLACE VIEW booking_reports AS
SELECT 
    b.*,
    e.title as event_title,
    e.start_at as event_date,
    v.name as venue_name,
    e.capacity_total as event_capacity
FROM bookings b
LEFT JOIN events e ON e.id = b.event_id
LEFT JOIN venues v ON v.id = e.venue_id;

-- ===== PERMISOS Y USUARIOS =====
-- Usuario de la aplicación
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cenart_user') THEN
        CREATE ROLE cenart_user LOGIN PASSWORD 'cenart_pass';
    END IF;
END$$;

-- Permisos
GRANT CONNECT ON DATABASE cenart TO cenart_user;
GRANT USAGE ON SCHEMA public TO cenart_user;

-- Permisos para tablas
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cenart_user;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO cenart_user;
GRANT SELECT ON events_availability TO cenart_user;
GRANT SELECT ON booking_reports TO cenart_user;

-- Permisos por defecto para futuras tablas
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cenart_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
GRANT SELECT ON SEQUENCES TO cenart_user;

-- ===== COMENTARIOS PARA DOCUMENTACIÓN =====
COMMENT ON TABLE venues IS 'Salas y espacios donde se realizan los eventos';
COMMENT ON TABLE events IS 'Eventos programados en el centro de artes';
COMMENT ON TABLE event_images IS 'Imágenes asociadas a cada evento';
COMMENT ON TABLE bookings IS 'Reservas de lugares para los eventos';
COMMENT ON COLUMN events.capacity_total IS 'Capacidad máxima del evento';
COMMENT ON COLUMN events.capacity_reserved IS 'Lugares reservados (calculado automáticamente)';
COMMENT ON COLUMN events.status IS 'Estado: scheduled, soldout, cancelled, postponed';
COMMENT ON COLUMN bookings.status IS 'Estado: confirmed, cancelled';
COMMENT ON VIEW events_availability IS 'Vista para consultar disponibilidad de eventos en tiempo real';

-- ===== MENSAGE DE ÉXITO =====
DO $$
BEGIN
    RAISE NOTICE 'Base de datos inicializada exitosamente:';
    RAISE NOTICE '- % sedes creadas', (SELECT COUNT(*) FROM venues);
    RAISE NOTICE '- % eventos de ejemplo', (SELECT COUNT(*) FROM events);
    RAISE NOTICE '- % reservas de ejemplo', (SELECT COUNT(*) FROM bookings);
    RAISE NOTICE '- Usuario cenart_user configurado';
END$$;