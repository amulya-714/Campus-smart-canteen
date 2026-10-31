-- =====================================================================
-- PLACEHOLDER SCHEMA  --  *** Person 1 will replace this ***
-- Only the minimum tables Person 2's code needs to run locally.
-- Person 1's real schema (constraints, triggers, locking, isolation levels)
-- goes elsewhere; see docs/INTEGRATION_CONTRACT.md for what must stay compatible.
-- =====================================================================

CREATE TABLE IF NOT EXISTS stalls (
  stall_id    SERIAL PRIMARY KEY,
  name        VARCHAR(80) NOT NULL UNIQUE,
  location    VARCHAR(120) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One users table with a role column (Person 1 may expose this as a VIEW over students/staff/admin tables)
CREATE TABLE IF NOT EXISTS users (
  user_id       SERIAL PRIMARY KEY,
  name          VARCHAR(80) NOT NULL,
  email         VARCHAR(160) NOT NULL,
  password_hash TEXT NOT NULL,                      -- bcrypt hash, never the password
  role          TEXT NOT NULL CHECK (role IN ('student','staff','admin')),
  stall_id      INT REFERENCES stalls(stall_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role <> 'staff' OR stall_id IS NOT NULL)   -- staff must belong to a stall
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS pickup_slots (
  slot_id      SERIAL PRIMARY KEY,
  stall_id     INT NOT NULL REFERENCES stalls(stall_id) ON DELETE CASCADE,
  slot_start   TIMESTAMPTZ NOT NULL,
  slot_end     TIMESTAMPTZ NOT NULL,
  capacity     INT NOT NULL DEFAULT 15 CHECK (capacity > 0),
  booked_count INT NOT NULL DEFAULT 0,
  CHECK (booked_count >= 0 AND booked_count <= capacity),   -- DB-level overbooking guard
  UNIQUE (stall_id, slot_start)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id          SERIAL PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,           -- idempotency key (see CONSISTENCY_DESIGN.md)
  student_id        INT NOT NULL REFERENCES users(user_id),
  stall_id          INT NOT NULL REFERENCES stalls(stall_id),
  slot_id           INT NOT NULL REFERENCES pickup_slots(slot_id),
  status            TEXT NOT NULL DEFAULT 'PLACED'
                    CHECK (status IN ('PLACED','PREPARING','READY','COMPLETED','CANCELLED')),
  total_amount      NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  order_item_id SERIAL PRIMARY KEY,
  order_id      INT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  menu_item_id  TEXT NOT NULL,                      -- = MongoDB menu_items._id (hex string)
  item_name     TEXT NOT NULL,                      -- snapshot: survives menu edits/deletes
  unit_price    NUMERIC(8,2) NOT NULL CHECK (unit_price >= 0),
  quantity      INT NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_stall_status ON orders (stall_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_student      ON orders (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created      ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_slots_stall_start   ON pickup_slots (stall_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_items_order         ON order_items (order_id);

-- Demo stalls (ids 1-4 match scripts/seed-mongo.ts)
INSERT INTO stalls (name, location, description)
SELECT * FROM (VALUES
  ('Fresh Squeeze',      'Main Canteen, Counter 1', 'Fresh juices and cold drinks'),
  ('Toasty Bites',       'Main Canteen, Counter 2', 'Grilled sandwiches and toasts'),
  ('Spice Route Snacks', 'Main Canteen, Counter 3', 'Samosas, vada pav, fries, maggi'),
  ('Meal Deal Counter',  'Main Canteen, Counter 4', 'Value combos for a full meal')
) AS v(name, location, description)
WHERE NOT EXISTS (SELECT 1 FROM stalls);

-- Generates 10-minute pickup windows (9:00-16:50) for today + N days, capacity 15 each.
CREATE OR REPLACE FUNCTION placeholder_generate_slots(days_ahead INT DEFAULT 2) RETURNS INT AS $$
DECLARE n INT;
BEGIN
  INSERT INTO pickup_slots (stall_id, slot_start, slot_end, capacity)
  SELECT s.stall_id, t, t + interval '10 minutes', 15
  FROM stalls s,
       generate_series(date_trunc('day', now()) + interval '9 hours',
                       date_trunc('day', now()) + make_interval(days => days_ahead) + interval '16 hours 50 minutes',
                       interval '10 minutes') AS t
  WHERE s.is_active AND EXTRACT(hour FROM t) BETWEEN 9 AND 16
  ON CONFLICT (stall_id, slot_start) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql;
