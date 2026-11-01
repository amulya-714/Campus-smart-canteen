# PostgreSQL viva notes (Person 1)

My DBMS concepts: **transactions & ACID · concurrency control (row locks, isolation levels) · integrity constraints & triggers · indexing & query optimization.**

## 1. Transactions and concurrency control

**Problem:** many students book the same 10-minute slot at the same moment. A slot has `capacity` places and `booked_count` says how many are taken. Reading the count and then adding 1 is two steps; two requests can both read "9 of 10" and both book, giving 11 of 10 (a *lost update*).

**Solution in `createOrder` (`lib/postgres/personOneAdapter.ts`), one transaction:**

1. `BEGIN`, then a quick idempotency check: if this `client_request_id` already has an order, return it.
2. `SELECT … FROM pickup_slots WHERE slot_id = $1 FOR UPDATE`: takes a **row lock**. A second booking for the same slot waits here.
3. Re-check `client_request_id` now that we hold the lock (`INSERT … ON CONFLICT DO NOTHING` is the final backstop). The waiting request now sees what the first one committed.
4. Validate: slot belongs to the stall, stall active, slot in the future, `booked_count < capacity`.
5. Insert the order and its items, then `booked_count = booked_count + 1`.
6. `COMMIT` (any error: `ROLLBACK`, so nothing is half-saved).

**Cancel (`cancelOrder`):** one guarded `UPDATE orders SET status='CANCELLED' … WHERE status='PLACED'`. Only the request whose update changes a row releases the slot, so capacity can't be released twice.

**Status changes (`updateOrderStatus`):** compare-and-set. The previous status is part of the `WHERE`, so check and write are one atomic statement. A staff update racing a student cancel cannot overwrite it or revive a cancelled order.

## 2. Isolation level: what we use and why

PostgreSQL's default is **READ COMMITTED** (the adapter issues a plain `BEGIN`; `npm run pg:explain` prints the level). Each *statement* sees data committed before it started.

| Level | What it prevents | Cost |
|---|---|---|
| READ COMMITTED (ours) | dirty reads | a statement may see newer data than the previous one |
| REPEATABLE READ | + non-repeatable reads (one snapshot per transaction) | concurrent update of the same row raises a serialization error you must retry |
| SERIALIZABLE | + all anomalies (write skew) | more aborts and retries |

**Why READ COMMITTED is enough here:** the only shared mutable value is the slot row, and we guard it with an explicit `FOR UPDATE` lock. After waiting on that lock, READ COMMITTED lets the next statement see the first request's committed order, which is exactly what the idempotency re-check relies on. A higher level would add retry logic without protecting anything more.

**Deadlocks:** a booking locks only one row (the slot). Cancel locks the order row and then the slot; a booking never locks an existing order, so there is no cycle of waiting.

## 3. Integrity enforced inside the database (`db/schema.sql`)

| Rule | Mechanism |
|---|---|
| never overbook or go negative | `CHECK` on `booked_count` vs `capacity` |
| order's slot belongs to the order's stall | composite foreign key `orders_slot_stall_fk (slot_id, stall_id)` |
| retries never create two orders | `UNIQUE (client_request_id)` |
| status only moves along the workflow | trigger `trg_orders_status_transition` |
| one account per email, any case | unique index on `lower(email)` |

**Why not only app code?** Other code, a future bug, or someone typing SQL can bypass it. The database is the last line of defence. (In testing I found `updateOrderStatus` could revive a cancelled order; the trigger now blocks it even from raw SQL.)

## 4. Indexing and query optimization (`npm run pg:explain`)

```bash
npm run pg:explain -- --bulk        # 100,000 temporary orders, always rolled back
```

On a tiny table PostgreSQL correctly picks a Seq Scan (cheaper than an index for ~500 rows), so use `--bulk` for the demo. For each query the script shows the real plan from `EXPLAIN (ANALYZE, BUFFERS)` and the same query with indexes disabled (Postgres' version of Mongo's `hint({$natural:1})`).

| Query | Index it uses | Why that index |
|---|---|---|
| order by `client_request_id` (every checkout) | `orders_client_request_id_key` (unique) | exact match, one row |
| login by email | `users_email_lower_uq` on `lower(email)` | query uses `lower(email)`, so the index is on the same expression |
| student's orders | `idx_orders_student (student_id, created_at DESC)` | equality on `student_id`, newest first |
| staff queue | `idx_orders_stall_status (stall_id, status)` | equality on both columns |
| open slots for a stall | `idx_slots_stall_start (stall_id, slot_start)` | equality then range on time |
| daily counts for the forecast | `idx_orders_created (created_at)` | range filter on time |

Example from one run on 100,000 orders (your numbers will differ): the idempotency lookup took **0.03 ms with the index vs 7.6 ms** forced to a Seq Scan; "my orders" **0.27 ms vs 6.2 ms**.

**How to read a plan:** `Index Scan` / `Bitmap Index Scan` = index used. `Seq Scan` = whole table read. `Execution Time` = real milliseconds. `Buffers: shared hit/read` = 8 kB pages touched.

**Be honest about:**
- The slots table is small (a few hundred rows), so its index barely matters; the order and user lookups are where indexes pay off.
- `getDailyOrderCounts` reads a third of the table in the demo, so a bitmap scan is only modestly faster. An index helps most when the range is a small fraction of the table.
- Every extra index slows `INSERT`/`UPDATE` a little. We only index columns that real queries filter on.

## 5. Likely questions

| Question | Short answer |
|---|---|
| How do you stop overbooking? | `FOR UPDATE` row lock on the slot inside one transaction, plus a `CHECK` constraint as backup. |
| What is a lost update? | Two transactions read the same value and both write back a change based on it; one change disappears. The row lock prevents it. |
| Why READ COMMITTED and not SERIALIZABLE? | One shared row, explicitly locked; a stricter level adds retries without more safety here. |
| What does `FOR UPDATE` do to other readers? | Plain `SELECT`s are not blocked; other `FOR UPDATE`/`UPDATE` on that row wait. |
| What if the app crashes mid-transaction? | PostgreSQL rolls back uncommitted work (Atomicity + Durability via WAL). |
| Why a trigger and a CHECK? | `CHECK` validates one row's values; the trigger compares old and new status, which a `CHECK` can't do. |
| How do retries stay safe? | Unique `client_request_id`, checked before and after the lock; the retry returns the original order. |
| How do you prove an index is used? | `npm run pg:explain -- --bulk`: Index Scan vs forced Seq Scan with times. |
| Postgres and Mongo in one transaction? | Not possible; the order saga in `lib/services/orderSaga.ts` compensates (returns stock) if the Postgres step fails. |
