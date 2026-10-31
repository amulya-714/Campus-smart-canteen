import { MongoClient, ObjectId } from 'mongodb';

// Set these before importing the application modules.
process.env.MONGODB_URI = 'mongodb://localhost:27017';
process.env.MONGODB_DB = 'campusbite_stock_test';

async function main() {
  const dbName = process.env.MONGODB_DB;

  // Fail closed: never run these tests against the application database.
  if (dbName !== 'campusbite_stock_test') {
    throw new Error(`Refusing to run against database: ${dbName}`);
  }

  const { getDb, closeMongo } = await import('../lib/mongo/client');
  const { reserveStock, releaseStock } = await import('../lib/mongo/menuRepo');

  const db = await getDb();

  if (db.databaseName !== 'campusbite_stock_test') {
    throw new Error(`Unexpected MongoDB database: ${db.databaseName}`);
  }

  const collection = db.collection('menu_items');
  const ids = [new ObjectId(), new ObjectId()];
  const requestId = `integration-test-${Date.now()}`;

  const documents = [
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
  ];

  const lines = [
    { menuItemId: ids[0].toHexString(), quantity: 2 },
  ];

  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(`FAIL: ${message}`);
    console.log(`PASS: ${message}`);
  };

  try {
    await collection.insertMany(documents);

    // 1. Reservation deducts the requested quantity.
    assert(
      (await reserveStock(lines, requestId)) === null,
      'reservation succeeds',
    );
    assert(
      (await collection.findOne({ _id: ids[0] }))?.stock === 8,
      'reservation deducts stock exactly once',
    );

    // 2. Retrying the same request must not deduct stock again.
    assert(
      (await reserveStock(lines, requestId)) === null,
      'repeated reservation succeeds idempotently',
    );
    assert(
      (await collection.findOne({ _id: ids[0] }))?.stock === 8,
      'repeated reservation does not deduct stock twice',
    );

    // 3. Releasing stock restores the original quantity.
    await releaseStock(lines, requestId);
    assert(
      (await collection.findOne({ _id: ids[0] }))?.stock === 10,
      'release restores stock',
    );

    // 4. Releasing twice must not restore stock twice.
    await releaseStock(lines, requestId);
    assert(
      (await collection.findOne({ _id: ids[0] }))?.stock === 10,
      'repeated release does not restore stock twice',
    );

    // 5. A multi-item reservation failure compensates earlier reservations.
    const partialRequestId = `${requestId}-partial`;
    const partialLines = [
      { menuItemId: ids[0].toHexString(), quantity: 3 },
      { menuItemId: ids[1].toHexString(), quantity: 2 },
    ];

    assert(
      (await reserveStock(partialLines, partialRequestId)) ===
        ids[1].toHexString(),
      'insufficient stock identifies the failing item',
    );
    assert(
      (await collection.findOne({ _id: ids[0] }))?.stock === 10,
      'partial failure restores previously reserved stock',
    );
    assert(
      (await collection.findOne({ _id: ids[1] }))?.stock === 1,
      'insufficient item stock remains unchanged',
    );

    console.log('\nAll MongoDB stock integration checks passed.');
  } finally {
    // Remove only these two uniquely identified test documents.
    await collection.deleteMany({ _id: { $in: ids } });
    await closeMongo();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
