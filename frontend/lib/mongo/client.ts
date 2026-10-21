import { MongoClient, type Db } from 'mongodb';
import { env } from '@/lib/config';

// In `next dev`, files reload often. Keep ONE client on `globalThis`
// so we don't open a new connection pool on every reload.
const g = globalThis as unknown as { _mongo?: Promise<MongoClient> };

export async function getDb(): Promise<Db> {
  if (!g._mongo) {
    g._mongo = new MongoClient(env('MONGODB_URI', 'mongodb://localhost:27017')).connect();
  }
  const client = await g._mongo;
  return client.db(env('MONGODB_DB', 'campusbite'));
}

export async function closeMongo() {
  if (g._mongo) { (await g._mongo).close(); g._mongo = undefined; }
}
