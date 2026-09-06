import { getPool } from "./pool";

export interface Device {
  id: string;
  label: string;
  apiKeyHash: string;
  createdAt: Date;
}

interface DeviceRow {
  id: string;
  label: string;
  api_key_hash: string;
  created_at: Date;
}

function mapRow(row: DeviceRow): Device {
  return {
    id: row.id,
    label: row.label,
    apiKeyHash: row.api_key_hash,
    createdAt: row.created_at,
  };
}

export async function findDeviceByApiKeyHash(apiKeyHash: string): Promise<Device | null> {
  const result = await getPool().query<DeviceRow>(
    "SELECT id, label, api_key_hash, created_at FROM devices WHERE api_key_hash = $1",
    [apiKeyHash]
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function findDeviceById(id: string): Promise<Device | null> {
  const result = await getPool().query<DeviceRow>(
    "SELECT id, label, api_key_hash, created_at FROM devices WHERE id = $1",
    [id]
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function createDevice(params: {
  id: string;
  label: string;
  apiKeyHash: string;
}): Promise<Device> {
  const result = await getPool().query<DeviceRow>(
    `INSERT INTO devices (id, label, api_key_hash)
     VALUES ($1, $2, $3)
     RETURNING id, label, api_key_hash, created_at`,
    [params.id, params.label, params.apiKeyHash]
  );
  return mapRow(result.rows[0]);
}
