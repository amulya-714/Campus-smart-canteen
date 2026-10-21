# Viva Notes (Person 2): short, casual, say-it-out-loud version

My four DBMS concepts: **polyglot persistence · document databases · cross-database consistency · indexing & query optimization.**
Plus: auth, ML forecasting and demand-aware ranking.

---
## 1. Polyglot persistence
**What:** Use the *right database for each kind of data* in one app.

| Data | Store | Why |
|---|---|---|
| Users, stalls, orders, pickup slots | **PostgreSQL** | relational, needs ACID transactions, constraints, joins, row locking |
| Menu items | **MongoDB** | every category has different fields; menus change often; read-heavy |

**Say:** "Orders and slots must never be wrong, so they live in a relational DB with transactions. Menus are flexible, so they live in a document DB. The two are linked by `stall_id` and `menu_item_id`."
**Code:** `lib/postgres/*` and `lib/mongo/*`. They only meet in `lib/services/orderSaga.ts`.
**Trade-off:** more moving parts, and no cross-DB foreign keys or transactions, so we added the saga.

## 2. Document database (MongoDB)
**What:** Stores JSON-like documents; two documents in one collection can have different shapes.
**Our model** (`lib/mongo/schemas.ts`):
```json
{ "stall_id": 2, "name": "Paneer Tikka Sandwich", "category": "sandwich", "price": 80,
  "is_available": true, "stock": 30, "tags": ["sandwich","veg"],
  "attributes": { "bread_type": "multigrain", "add_ons": ["mint chutney"], "is_spicy": true, "is_veg": true } }
```
- juice → `size, sugar_level` · sandwich → `bread_type, add_ons[], is_spicy, is_veg` · snack → `is_veg, portion` · combo → `combo_items[], is_veg`
- In SQL this needs either many NULL columns or an EAV table; in Mongo each doc holds only what it needs.
- **Validation:** `$jsonSchema` validator with `oneOf` per category (the *database* rejects bad docs) + zod in the API.
- **Aggregation pipeline:** `getAvailabilityByStall` groups items per stall to count what's orderable (feeds ranking).
- **Atomic single-doc operations:** `updateOne({stock: {$gte: qty}}, {$inc: {stock: -qty}})` can't oversell.
- **Why not embed menu in a stall document?** Items are updated independently and often (stock), queried across stalls (search), and would make one big hot document.

## 3. Cross-database consistency
(Full detail: `CONSISTENCY_DESIGN.md`)
**Problem:** an order changes Mongo (stock) *and* Postgres (order + slot). No shared transaction.
**Solution: Saga.** Validate+snapshot → log saga → reserve stock (Mongo) → create order (Postgres, Person 1's transaction) → commit saga. If the Postgres step fails, **compensate** by returning stock.
**Extras:** idempotency key (`requestId`), saga log, reconciler job, "unknown outcome" check before compensating.
**Why not 2PC?** Needs a transaction coordinator both stores support; blocks and holds locks if anything crashes; overkill here.
**Honest limits:** eventually consistent after a crash (until reconcile), small double-release window (documented).

## 4. Indexing & query optimization
Indexes on `menu_items` (`lib/mongo/indexes.ts`):

| Index | Query it serves |
|---|---|
| `{stall_id, is_available, stock}` | "what can I order at stall X right now?" (most common) |
| `{category, is_available}` | browse by category |
| text on `name, description, tags` | search box (`$text`, ranked by `textScore`) |
| saga `{status, updated_at}` | reconciler finds stuck sagas fast |

**Prove it:** `npm run mongo:explain` runs `explain('executionStats')` and prints `IXSCAN` vs `COLLSCAN` plus `docsExamined`, including a forced collection scan (`hint({$natural:1})`) for comparison.
**Say:** "COLLSCAN reads every document, cost grows with collection size. IXSCAN jumps to matching entries, cost grows with the *result* size. Our index is compound with equality fields first (`stall_id`, `is_available`) then the range field (`stock`): the ESR-style rule."
**Also:** menus are fetched with one query per stall (no N+1); stall list does 3 parallel calls (stalls, load, availability) and joins in memory; Postgres order list uses one query with `json_agg` for items.

## 5. Authentication & RBAC
- **bcrypt** (cost 12, salted): `lib/auth/password.ts`. Only the hash is stored.
- **JWT** in an **httpOnly, SameSite=Lax** cookie (JS can't read it → XSS can't steal it; Lax blocks most CSRF).
- `withAuth(['staff','admin'], handler)` is the RBAC middleware: 401 no/invalid token, 403 wrong role. Staff are also restricted to **their own stall** (`assertStallAccess`).
- Sign-up always makes a *student*; a `role` field in the body is rejected (`.strict()`). Staff are made by admins.
- Same error for "unknown email" and "wrong password"; login rate-limited.
- `studentId` for orders always comes from the cookie, never the request body.

## 6. Demand forecasting (ML)
- **Goal:** predict orders per stall per hour for tomorrow → staffing/inventory.
- **Data:** SYNTHETIC (invented, flagged `is_synthetic`) because no real data yet.
- **Features:** stall, weekday, hour, yesterday's demand (`lag1`), same weekday last week (`lag7`), last-7-day average (`avg7`).
- **Models:** Linear Regression vs Random Forest vs naive baseline ("same as last week"). **Time-based** train/test split (last 21 days = test) because we forecast the future.
- **Metrics:** MAE (avg error in orders), RMSE (punishes big errors), R².
- **Result on our synthetic data:** random forest best, but only modestly better than the baseline (see `ml/model/metrics.json` after training); holidays and random noise are unpredictable by design.
- **Used in app:** `ml/predict.py` writes JSON → `lib/services/forecast.ts` → `/api/forecast` → staff & admin charts. Retrain periodically (`npm run ml:train`, e.g. nightly cron) once real orders are exported.
- **Limitation:** model has never seen real students; accuracy claims only apply to synthetic data.

## 7. Demand-aware ranking
`stall score = 100 × (0.4 × availability + 0.4 × (1 − load) + 0.2 × slots free)`
- availability = orderable items / total items · load = active orders / 20 (max 1) · slots free = 1 − booked/capacity over the next hour.
- Overloaded stalls sink in the list, so students are nudged to quieter stalls (smooths demand).
- Item search score = `0.5 × text relevance + 0.5 × stall score`. Code: `lib/services/ranking.ts` (+ `tests/ranking.test.ts`).

---
## Likely viva questions

| Question | Short answer |
|---|---|
| Why two databases? | Right tool for each job; relational integrity for orders, flexible schema for menus. |
| What if Mongo succeeds and Postgres fails? | Compensate: release the reserved stock; saga log + reconciler cover crashes. |
| How do you stop two students taking the last item? | Mongo atomic `$inc` with `stock >= qty` filter (one document operation). |
| How do you stop overbooking a slot? | Person 1's Postgres transaction: `SELECT … FOR UPDATE` on the slot row + CHECK constraint. I only handle the failure (`SlotFullError`) and undo stock. |
| What if the user double-clicks "Place order"? | Same `requestId` → unique constraint + saga `_id` → one order. |
| What if a menu item is deleted after ordering? | Order keeps `item_name` + `unit_price` snapshot. |
| How do you know the index is used? | `explain('executionStats')`: `IXSCAN`, low `docsExamined` (`npm run mongo:explain`). |
| Is MongoDB ACID? | Single-document operations are atomic; multi-document transactions need a replica set. We avoided needing them by design (saga). |
| Why not store passwords encrypted? | Encryption is reversible; hashing isn't. bcrypt is slow + salted. |
| Is the forecast accurate? | Only tested on synthetic data; we report MAE/RMSE/R² vs a baseline and say so honestly. |
