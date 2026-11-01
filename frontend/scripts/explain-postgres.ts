/**
 * Shows that our PostgreSQL indexes are really used, using EXPLAIN (ANALYZE, BUFFERS).
 * Run:  npm run pg:explain               (uses the data already in your database)
 *       npm run pg:explain -- --bulk     (recommended for the demo, see below)
 *       npm run pg:explain -- --bulk=200000
 *
 * Why --bulk?  On a tiny table PostgreSQL correctly prefers a Seq Scan (reading 500 rows is
 * cheaper than using an index), so the demo proves nothing. --bulk inserts synthetic users and
 * orders INSIDE A TRANSACTION THAT IS ALWAYS ROLLED BACK, so your real data is never touched.
 *
 * For every query the script prints:
 *   1. the plan PostgreSQL really used (index scan or seq scan) and its execution time
 *   2. the same query with indexes switched off (forced Seq Scan), the PostgreSQL version of
 *      Mongo's hint({ $natural: 1 }) in scripts/explain-mongo.ts, so you can compare times
 *
 * What to look at in the output:
 *   Index Scan / Index Only Scan / Bitmap Index Scan   an index was used (good)
 *   Seq Scan                                           the whole table was read (slow as it grows)
 *   Execution Time                                     real time in ms
 *   Buffers: shared hit/read                           8 kB pages touched (fewer = less work)
 */
import type { PoolClient } from 'pg';
import { pool } from '../lib/postgres/client';

const bulkArg = process.argv.find((a) => a === '--bulk' || a.startsWith('--bulk='));
const BULK_ORDERS = bulkArg ? Number(bulkArg.split('=')[1] ?? 100_000) : 0;
const BULK_USERS = 2_000;

async function plan(client: PoolClient, sql: string): Promise<string[]> {
  const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  return res.rows.map((r) => r['QUERY PLAN'] as string);
}

function summarize(lines: string[]) {
  const text = lines.join('\n');
  const scans: string[] = [];
  for (const line of lines) {
    const m = line.match(/(?<!Bitmap )(Seq Scan|Index Only Scan|Index Scan|Bitmap Heap Scan) (?:Backward )?(?:using (\S+) )?on (\S+)/);
    if (m) scans.push(m[2] ? `${m[1]} on ${m[3]} using ${m[2]}` : `${m[1]} on ${m[3]}`);
    const b = line.match(/Bitmap Index Scan on (\S+)/);
    if (b) scans.push(`Bitmap Index Scan using ${b[1]}`);
  }
  const time = text.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? '?';
  return { scans, time: Number(time) };
}

async function show(client: PoolClient, label: string, sql: string) {
  console.log(`\n=== ${label} ===`);
  console.log(sql.trim().replace(/\n\s+/g, '\n  '));

  const normal = await plan(client, sql);
  const n = summarize(normal);
  console.log('\n-- plan PostgreSQL chose --');
  console.log(normal.map((l) => '  ' + l).join('\n'));

  // Same query with index access switched off for this transaction only.
  await client.query('SAVEPOINT noidx');
  await client.query('SET LOCAL enable_indexscan = off');
  await client.query('SET LOCAL enable_indexonlyscan = off');
  await client.query('SET LOCAL enable_bitmapscan = off');
  const forced = summarize(await plan(client, sql));
  await client.query('ROLLBACK TO SAVEPOINT noidx');

  console.log('\n-- summary --');
  console.log('  with indexes    :', n.scans.join(' ; ') || '(no table scan node)', `| ${n.time} ms`);
  console.log('  indexes disabled:', forced.scans.join(' ; ') || '(no table scan node)', `| ${forced.time} ms`);
  if (n.scans.every((s) => s.startsWith('Seq Scan')) && n.scans.length) {
    console.log('  note            : PostgreSQL chose a Seq Scan, usually because the table is small. Try --bulk.');
  }
}

async function addBulkData(client: PoolClient) {
  console.log(`Adding ${BULK_USERS} temporary students and ${BULK_ORDERS} temporary orders (will be rolled back)...`);
  await client.query(
    `INSERT INTO users (name, email, password_hash, role)
     SELECT 'Explain Student ' || g, 'explain-student-' || g || '@explain.invalid', 'x', 'student'
     FROM generate_series(1, $1::int) g`,
    [BULK_USERS],
  );
  await client.query(
    `WITH students AS (
       SELECT array_agg(user_id ORDER BY user_id) AS ids FROM users WHERE email LIKE 'explain-student-%@explain.invalid'
     ),
     slots AS (
       SELECT slot_id, stall_id, row_number() OVER (ORDER BY slot_id) AS rn FROM pickup_slots
     ),
     n AS (SELECT count(*) AS c FROM slots)
     INSERT INTO orders (client_request_id, student_id, stall_id, slot_id, status, total_amount, created_at, updated_at)
     SELECT 'explain-' || g,
            students.ids[1 + (g % array_length(students.ids, 1))],
            slots.stall_id,
            slots.slot_id,
            (ARRAY['COMPLETED','COMPLETED','COMPLETED','CANCELLED','PLACED','PREPARING'])[1 + (g % 6)],
            100,
            now() - (g % 90) * interval '1 day' - (g % 1440) * interval '1 minute',
            now()
     FROM generate_series(1, $1::int) g
     CROSS JOIN students
     CROSS JOIN n
     JOIN slots ON slots.rn = 1 + (g % n.c)`,
    [BULK_ORDERS],
  );
  // Refresh planner statistics, as autovacuum would on a real, busy database.
  await client.query('ANALYZE users');
  await client.query('ANALYZE orders');
}

async function main() {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    // Isolation level the adapter's transactions run at (it issues a plain BEGIN).
    const iso = await client.query('SHOW transaction_isolation');
    console.log(`Transaction isolation level used by the adapter: ${iso.rows[0].transaction_isolation}`);

    if (BULK_ORDERS > 0) await addBulkData(client);
    else console.log('Tip: run with --bulk to get a meaningful comparison on a larger table.');

    const stall = Number((await client.query('SELECT stall_id FROM stalls ORDER BY stall_id LIMIT 1')).rows[0]?.stall_id ?? 1);
    const student = Number(
      (await client.query(
        `SELECT student_id FROM orders GROUP BY student_id ORDER BY count(*) DESC, student_id LIMIT 1`,
      )).rows[0]?.student_id ?? 1,
    );
    const requestId = (await client.query('SELECT client_request_id FROM orders ORDER BY order_id DESC LIMIT 1')).rows[0]?.client_request_id ?? 'none';
    const total = (await client.query('SELECT count(*)::int AS c FROM orders')).rows[0].c;
    console.log(`orders in table: ${total}   (stall ${stall}, student ${student})`);

    await show(client, 'listOpenSlots(stall): student picks a pickup slot', `
      SELECT ps.*
      FROM pickup_slots ps
      JOIN stalls s ON s.stall_id = ps.stall_id
      WHERE ps.stall_id = ${stall}
        AND ps.slot_start > now()
        AND ps.booked_count < ps.capacity
        AND s.is_active = TRUE
      ORDER BY ps.slot_start
      LIMIT 36`);

    await show(client, 'listOrdersByStudent(student): "my orders" page (item-JSON subquery omitted)', `
      SELECT o.*, s.name AS stall_name, ps.slot_start
      FROM orders o
      JOIN stalls s ON s.stall_id = o.stall_id
      JOIN pickup_slots ps ON ps.slot_id = o.slot_id
      WHERE o.student_id = ${student}
      ORDER BY o.created_at DESC
      LIMIT 50`);

    await show(client, 'listOrdersByStall(stall, active statuses): staff queue (item-JSON subquery omitted)', `
      SELECT o.*, ps.slot_start
      FROM orders o
      JOIN pickup_slots ps ON ps.slot_id = o.slot_id
      WHERE o.stall_id = ${stall}
        AND o.status = ANY(ARRAY['PLACED','PREPARING']::text[])
      ORDER BY ps.slot_start, o.order_id
      LIMIT 200`);

    await show(client, 'getOrderByRequestId: idempotency check on every checkout', `
      SELECT o.order_id FROM orders o WHERE o.client_request_id = '${String(requestId).replace(/'/g, "''")}'`);

    await show(client, 'getDailyOrderCounts(30): feeds the demand forecast', `
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date, stall_id, COUNT(*)::int AS orders
      FROM orders
      WHERE created_at >= now() - make_interval(days => 30)
        AND status <> 'CANCELLED'
      GROUP BY created_at::date, stall_id
      ORDER BY created_at::date, stall_id`);

    await show(client, 'findUserByEmail: login', `
      SELECT * FROM users WHERE lower(email) = lower('explain-student-1@explain.invalid')`);

    console.log('\nDone. Nothing was saved: the transaction is rolled back.');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool().end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
