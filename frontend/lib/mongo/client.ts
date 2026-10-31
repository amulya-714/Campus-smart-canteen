import { MongoClient, type Db } from 'mongodb';
import { env } from '@/lib/config';

const g = globalThis as unknown as {
  _mongo?: Promise<MongoClient>;
};

export async function getDb(): Promise<Db> {
  if (!g._mongo) {
    g._mongo = new MongoClient(
      env('MONGODB_URI', 'mongodb://localhost:27017'),
    ).connect();
  }

  const client = await g._mongo;
  return client.db(env('MONGODB_DB', 'campusbite'));
}

export async function closeMongo(): Promise<void> {
  if (g._mongo) {
    const connection = g._mongo;
    g._mongo = undefined;
    await (await connection).close();
  }
}
