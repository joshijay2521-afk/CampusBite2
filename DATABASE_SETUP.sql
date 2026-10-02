-- CampusBite does not require you to run this file when the server can create
-- tables automatically. Keep it as a reference/backup schema.
CREATE TABLE IF NOT EXISTS cb_products (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS cb_orders (id text PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS cb_chats (id text PRIMARY KEY, order_id text NOT NULL, data jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS cb_settings (id integer PRIMARY KEY, data jsonb NOT NULL);
