import { Pool } from 'pg';
import { env } from '@/lib/config';

const g = globalThis as unknown as { _pgPool?: Pool };

export function pool(): Pool {
  if (!g._pgPool) {
    g._pgPool = new Pool({ connectionString: env('DATABASE_URL'), max: 10 });
  }
  return g._pgPool;
}
