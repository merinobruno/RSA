-- Initial schema for the aircraft telemetry tracking server.

CREATE TABLE IF NOT EXISTS devices (
    id            UUID PRIMARY KEY,
    label         TEXT NOT NULL,
    api_key_hash  TEXT NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID NOT NULL REFERENCES devices (id),
    packet_id       UUID NOT NULL,
    captured_at     TIMESTAMPTZ NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    altitude_m      DOUBLE PRECISION NOT NULL,
    gps_accuracy_m  DOUBLE PRECISION NOT NULL,
    speed_mps       DOUBLE PRECISION NOT NULL,
    heading_deg     DOUBLE PRECISION NOT NULL,
    accel_x         DOUBLE PRECISION NOT NULL,
    accel_y         DOUBLE PRECISION NOT NULL,
    accel_z         DOUBLE PRECISION NOT NULL,
    battery_pct     DOUBLE PRECISION NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT telemetry_device_packet_unique UNIQUE (device_id, packet_id)
);

-- Speeds up the GET /v1/devices/:id/telemetry query (filter by device,
-- range on captured_at, ordered by captured_at).
CREATE INDEX IF NOT EXISTS idx_telemetry_device_captured_at
    ON telemetry (device_id, captured_at);
