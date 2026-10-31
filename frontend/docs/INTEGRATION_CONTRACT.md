# Integration Contract: Person 1 ⇄ Person 2

Person 2 (menu/app/intelligence) needs a few things from Person 1's PostgreSQL work.
This file lists **exactly** what my code assumes, so we can swap Person 1's real implementation in with tiny changes.

> **Rule:** only `lib/postgres/` knows about PostgreSQL. Everything else calls the `PgAdapter` interface in `lib/postgres/types.ts`.
> `db/placeholder_schema.sql` + `lib/postgres/placeholderAdapter.ts` are **placeholders – Person 1 will replace them.**

## 1. Tables / columns my code assumes

If Person 1 names things differently, change the SQL in the adapter, not the app.

| Table | Columns I read/write | Notes |
|---|---|---|
| `users` *(or a VIEW over students/staff/admin)* | `user_id` PK, `name`, `email` (unique, case-insensitive), `password_hash`, `role` ∈ `student/staff/admin`, `stall_id` (staff only) | I store **bcrypt hashes only**. If Person 1 has separate `students` / `staff` tables, expose a `users` VIEW with these columns. |
| `stalls` | `stall_id` PK, `name`, `location`, `description`, `is_active` | "Remove stall" = `is_active = false` (orders keep history). |
| `pickup_slots` | `slot_id` PK, `stall_id`, `slot_start`, `slot_end`, `capacity`, `booked_count` | One order = **one** booking in a slot. `booked_count <= capacity` should be enforced by Person 1 (CHECK + locking). |
| `orders` | `order_id` PK, **`client_request_id` UNIQUE**, `student_id`, `stall_id`, `slot_id`, `status`, `total_amount`, `created_at`, `updated_at` | `status` ∈ `PLACED, PREPARING, READY, COMPLETED, CANCELLED`. |
| `order_items` | `order_item_id` PK, `order_id`, **`menu_item_id` TEXT**, **`item_name`**, **`unit_price`**, `quantity` | See §3 for the MongoDB link. |

### The three things I really need Person 1 to keep
1. **`orders.client_request_id` UNIQUE**: my idempotency key. Same key twice must not create two orders.
2. **`order_items.menu_item_id` is TEXT** holding a 24-char hex MongoDB `_id`, and **`item_name` + `unit_price` are stored as a snapshot** (menu edits/deletes must never change old orders). No foreign key is possible to MongoDB.
3. **`cancelOrder` frees the slot** (`booked_count - 1`) and only works while status = `PLACED`.

## 2. Functions I expect (the `PgAdapter` interface)

| Adapter method (`lib/postgres/types.ts`) | Suggested Person 1 SQL function / endpoint | Must do | Errors I handle |
|---|---|---|---|
| `createOrder(input)` | `create_order(...)` which calls `book_slot(slot_id)` | **One transaction:** lock slot row (`FOR UPDATE`), check capacity, insert order + items, increment `booked_count`. If `client_request_id` exists → return the existing order. | `SlotFullError`, `SlotUnavailableError` |
| `cancelOrder(orderId, studentId?)` | `cancel_order(...)` | Set `CANCELLED`, free slot. Return `null` if not cancellable. | – |
| `getOrder(id)`, `getOrderByRequestId(rid)` | read queries | Order with items (+ stall name, student name, `slot_start`). | – |
| `listOrdersByStudent(id)` | read | Newest first. | – |
| `listOrdersByStall(stallId, statuses?)` | `list_orders_by_stall` | For the staff board. | – |
| `listAllOrders(limit)` | read | Admin view. | – |
| `updateOrderStatus(id, status, stallId?)` | `update_order_status` | If `stallId` given, only update when the order belongs to it. | – |
| `listOpenSlots(stallId)` | read | Future slots with `capacity`, `booked_count`. | – |
| `getSlotUtilization(stallId?)` | `get_slot_utilization` | Today's slots (admin chart). | – |
| `getStallLoad()` | read / view | Per active stall: `activeOrders` (PLACED+PREPARING), `capacityNextHour`, `bookedNextHour`. **Feeds the ranking.** | – |
| `getDailyOrderCounts(days)` | read | `{date, stallId, orders}` (excl. cancelled). **Same data trains the ML model.** | – |
| `createUser / findUserByEmail / findUserById / listStaff / deleteUser` | CRUD | `createUser` throws `DuplicateEmailError` on unique violation. | `DuplicateEmailError` |
| `listStalls / getStall / createStall / deactivateStall` | CRUD | – | – |

Error classes (`SlotFullError`, …) live in `lib/postgres/types.ts`. Person 1's code just throws them (or the adapter maps their DB errors to them).

## 3. How PostgreSQL points to MongoDB

```
PostgreSQL                                MongoDB (menu_items)
order_items.menu_item_id  ───────────►   _id  (ObjectId, stored as 24-char hex string)
orders.stall_id / stalls.stall_id ───►   stall_id (integer)
order_items.item_name, unit_price         = SNAPSHOT copied from the Mongo doc at order time
```
No cross-database foreign keys exist, so integrity is kept by the saga in `lib/services/orderSaga.ts`
(see `CONSISTENCY_DESIGN.md`).

## 4. How Person 1 swaps their implementation in (3 steps)

1. Implement `PgAdapter` (e.g. `lib/postgres/personOneAdapter.ts`), using their functions inside.
2. In `lib/postgres/index.ts` change one line: `export const db: PgAdapter = new PersonOneAdapter();`
3. Run `npm test` (tests use fakes, so they keep passing) and then the end-to-end checklist below.

`scripts/setup-postgres.ts` only creates the *placeholder* tables and demo users: skip it once Person 1's schema exists, but you still need demo users (admin/staff/student) with bcrypt hashes; adapt that script's `DEMO` list.

## 5. Shared end-to-end test checklist (do together)

| # | Scenario | Expected |
|---|---|---|
| 1 | 20 students book a slot with capacity 15 at once (script with `Promise.all`) | exactly 15 orders succeed, 5 get "slot just filled up", **Mongo stock restored for the 5** |
| 2 | Same checkout sent twice (same `requestId`) | 1 order, stock decremented once |
| 3 | Stop PostgreSQL mid-checkout | 503, Mongo stock unchanged after `npm run reconcile` |
| 4 | Two students buy the last unit of an item | one succeeds, one gets "took the last of an item" |
| 5 | Cancel a `PLACED` order | slot count −1, Mongo stock +qty |
| 6 | Staff of stall A calls PATCH on stall B's order / menu item | 403 |
| 7 | Edit a menu item's price after an order | old order still shows the old price |
