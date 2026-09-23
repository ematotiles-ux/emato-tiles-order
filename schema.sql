-- ==========================================================
-- Ceramic Order Manager v2.0 - Database Schema with Multi-Factory Support
-- ==========================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL DEFAULT 'EM-1001', -- Booking Reference / Group ID
    place_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('READY', 'NOT READY', 'DISPATCHED', 'BILLED DONE', 'CANCELLED')) DEFAULT 'NOT READY',
    party_type TEXT NOT NULL DEFAULT 'DEALER' CHECK (party_type IN ('DEALER', 'PROJECT', 'DEPO ORDER')),
    manage_by TEXT NOT NULL,
    client_name TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    factory_name TEXT NOT NULL,
    size TEXT NOT NULL,
    product TEXT NOT NULL,
    finish_optional TEXT DEFAULT '',
    grade TEXT NOT NULL DEFAULT 'PRM',
    box_qty INTEGER NOT NULL CHECK (box_qty >= 0),
    box_weight REAL NOT NULL CHECK (box_weight >= 0),
    total_weight REAL NOT NULL CHECK (total_weight >= 0),
    remark TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_manage_by ON orders(manage_by);
CREATE INDEX IF NOT EXISTS idx_orders_factory_name ON orders(factory_name);
CREATE INDEX IF NOT EXISTS idx_orders_client_name ON orders(client_name);
CREATE INDEX IF NOT EXISTS idx_orders_place_date ON orders(place_date);
CREATE INDEX IF NOT EXISTS idx_orders_party_type ON orders(party_type);

-- View: v_orders_live
DROP VIEW IF EXISTS v_orders_live;
CREATE VIEW v_orders_live AS
SELECT 
    id,
    order_no,
    place_date,
    strftime('%d/%m/%Y', place_date) AS place_date_formatted,
    CAST(MAX(0, ROUND(julianday('now', 'localtime') - julianday(place_date))) AS INTEGER) AS order_day,
    status,
    party_type,
    manage_by,
    client_name,
    city,
    state,
    factory_name,
    size,
    product,
    finish_optional,
    grade,
    box_qty,
    box_weight,
    total_weight,
    ROUND(total_weight / 1000.0, 2) AS total_weight_mt,
    CASE 
        WHEN (julianday('now', 'localtime') - julianday(place_date)) >= 15 THEN 'CRITICAL'
        WHEN (julianday('now', 'localtime') - julianday(place_date)) >= 7 THEN 'WARNING'
        ELSE 'NORMAL'
    END AS aging_category,
    remark,
    created_at,
    updated_at
FROM orders;

-- View: v_factory_summary
DROP VIEW IF EXISTS v_factory_summary;
CREATE VIEW v_factory_summary AS
SELECT 
    factory_name,
    COUNT(*) AS total_orders,
    SUM(box_qty) AS total_boxes,
    ROUND(SUM(total_weight) / 1000.0, 1) AS total_weight_tons,
    SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready_orders,
    SUM(CASE WHEN status = 'NOT READY' THEN 1 ELSE 0 END) AS pending_orders
FROM orders
GROUP BY factory_name;
