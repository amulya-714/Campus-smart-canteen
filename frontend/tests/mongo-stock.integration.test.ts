import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient, ObjectId, type Collection, type Document } from 'mongodb';

const TEST_DB = 'campusbite_stock_test';
const TEST_URI = 'mongodb://localhost:27017';

let client: MongoClient;
let collection: Collection<Document>;

let reserveStock: typeof import('@/lib/mongo/menuRepo').reserveStock;
let releaseStock: typeof import('@/lib/mongo/menuRepo').releaseStock;
let closeMongo: typeof import('@/lib/mongo/client').closeMongo;

const ids = [new ObjectId(), new ObjectId()];
const requestId = `vitest-stock-${Date.now()}`;

beforeAll(async () => {
  // Configure the test database before importing the real stock functions.
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DB = TEST_DB;

  client = new MongoClient(TEST_URI);
  await client.connect();

  const db = client.db(TEST_DB);

  if (db.databaseName !== TEST_DB) {
    throw new Error(`Unexpected database: ${db.databaseName}`);
  }

  collection = db.collection('menu_items');

  const menuRepo = await import('@/lib/mongo/menuRepo');
  const mongoClientModule = await import('@/lib/mongo/client');

  reserveStock = menuRepo.reserveStock;
  releaseStock = menuRepo.releaseStock;
  closeMongo = mongoClientModule.closeMongo;

  await collection.insertMany([
    {
      _id: ids[0],
      stall_id: 999,
      name: 'Integration Test Juice',
      category: 'juice',
      description: 'Temporary test document',
      price: 50,
      is_available: true,
      stock: 10,
      tags: ['test'],
      attributes: { size: 'medium', sugar_level: 'regular' },
      created_at: new Date(),
      updated_at: new Date(),
      stock_operations: [],
    },
    {
      _id: ids[1],
      stall_id: 999,
      name: 'Integration Test Snack',
      category: 'snack',
      description: 'Temporary test document',
      price: 30,
      is_available: true,
      stock: 1,
      tags: ['test'],
      attributes: { is_veg: true, portion: 'regular' },
      created_at: new Date(),
      updated_at: new Date(),
      stock_operations: [],
    },
  ]);
});

afterAll(async () => {
  try {
    if (collection) {
      await collection.deleteMany({ _id: { $in: ids } });
    }
  } finally {
    try {
      if (closeMongo) {
        await closeMongo();
      }
    } finally {
      if (client) {
        await client.close();
      }
    }
  }
});

describe('MongoDB stock integration', () => {
  it('reserves stock and makes retries idempotent', async () => {
    const lines = [{ menuItemId: ids[0].toHexString(), quantity: 2 }];

    expect(await reserveStock(lines, requestId)).toBeNull();
    expect((await collection.findOne({ _id: ids[0] }))?.stock).toBe(8);

    expect(await reserveStock(lines, requestId)).toBeNull();
    expect((await collection.findOne({ _id: ids[0] }))?.stock).toBe(8);
  });

  it('restores stock only once', async () => {
    const lines = [{ menuItemId: ids[0].toHexString(), quantity: 2 }];

    await releaseStock(lines, requestId);
    await releaseStock(lines, requestId);

    expect((await collection.findOne({ _id: ids[0] }))?.stock).toBe(10);
  });

  it('compensates earlier reservations when a later item has insufficient stock', async () => {
    const partialRequestId = `${requestId}-partial`;

    const lines = [
      { menuItemId: ids[0].toHexString(), quantity: 3 },
      { menuItemId: ids[1].toHexString(), quantity: 2 },
    ];

    expect(await reserveStock(lines, partialRequestId)).toBe(
      ids[1].toHexString(),
    );

    expect((await collection.findOne({ _id: ids[0] }))?.stock).toBe(10);
    expect((await collection.findOne({ _id: ids[1] }))?.stock).toBe(1);
  });
});
