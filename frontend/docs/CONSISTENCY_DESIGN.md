# Cross-Database Consistency: how CampusBite keeps PostgreSQL and MongoDB in step

## The problem
Placing an order changes **two** databases:

| Store | What changes |
|---|---|
| MongoDB | menu item **stock** goes down; item details are read |
| PostgreSQL | **order**, **order items**, and the **slot's booked count** |

There is no transaction that spans both. If we do them one after the other and the second fails, we get problems like *stock reduced but no order* (food "disappears") or *order exists but stock never reduced* (overselling).

## The pattern we use: an orchestrated **Saga** with compensation
A saga = a list of **local** steps. If step *N* fails, run **compensating actions** that undo steps *1…N-1*.
(We chose this over **Two-Phase Commit** because MongoDB and PostgreSQL don't give us a shared coordinator, and 2PC would hold locks across systems and block on any crash.)

```mermaid
sequenceDiagram
  participant S as Student (browser)
  participant API as Next.js order service
  participant M as MongoDB
  participant P as PostgreSQL
  S->>API: POST /api/orders (requestId, items, slot)
  API->>P: 0. order with this requestId exists?
  API->>M: 1. read items (validate, snapshot name+price)
  API->>M: 2. save saga log = PENDING
  API->>M: 3. reserve stock (atomic $inc, stock >= qty)
  API->>P: 4. BEGIN; lock slot; check capacity; insert order+items; COMMIT
  alt step 4 OK
    API->>M: 5. saga = COMMITTED
    API-->>S: 201 order
  else slot full / DB error
    API->>M: COMPENSATE: give stock back, saga = COMPENSATED
    API-->>S: 409 / 503
  end
```

| Step | Store | Action | Compensation if a later step fails |
|---|---|---|---|
| 0 | PostgreSQL | Idempotency check on `client_request_id` | none (read only) |
| 1 | MongoDB | Validate + **snapshot** name/price | none (read only) |
| 2 | MongoDB | Write `order_sagas` doc (`_id = requestId`) | mark `COMPENSATED` |
| 3 | MongoDB | `updateOne({stock >= qty}, {$inc: -qty})` per item | `$inc: +qty` (`releaseStock`) |
| 4 | PostgreSQL | Create order in **one** transaction (Person 1's slot locking) | `cancelOrder` / nothing needed: it rolled back itself |
| 5 | MongoDB | Saga → `COMMITTED` | – |

**Order of steps is deliberate:** the step most likely to fail for business reasons (stock) and the one that is easiest to undo go **before** the PostgreSQL commit. PostgreSQL, the "source of truth" for money and slots, is written last, so we never have to roll back a committed order.

## Four tools that make it safe

1. **Atomic single-document updates** (Mongo): `stock >= qty` and `$inc` happen in one operation, so two students can never both take the last unit.
2. **Idempotency key** (`requestId` = `orders.client_request_id` UNIQUE + saga `_id`): double-clicks and retries create **one** order.
3. **Saga log** (`order_sagas`): written *before* stock changes, so a crash always leaves evidence of what was in flight.
4. **Reconciler** (`npm run reconcile`, run every few minutes): finds stuck sagas and finishes or undoes them.

## Failure matrix

| What fails | What the student sees | What the system does | Final state |
|---|---|---|---|
| Item sold out / not on menu (step 1) | 409 with item name | nothing was touched | consistent |
| Last unit taken by someone else (step 3) | 409 "took the last of an item" | partial reservations in this cart are released | consistent |
| Slot full (step 4) | 409 "slot just filled up" | **release stock**, saga `COMPENSATED` | consistent |
| PostgreSQL down (step 4) | 503 "nothing was reserved" | release stock, saga `COMPENSATED` | consistent |
| PostgreSQL **committed but reply lost** (timeout) | normal success | before compensating we **look the order up by `requestId`**; found → treat as success | consistent |
| MongoDB down while **releasing** stock | 409/503 as above | saga set to `RESTOCK_PENDING` (or left `PENDING` if Mongo is totally down) | reconciler fixes later |
| App **crashes after step 3**, before step 4 | order never appears | saga stays `PENDING`; reconciler sees no order → releases stock | consistent after reconcile |
| App crashes **after step 4**, before step 5 | order appears normally | saga stays `PENDING`; reconciler sees the order → marks `COMMITTED` | consistent after reconcile |
| Student cancels (`PLACED` only) | order cancelled | PostgreSQL first (frees slot), then stock restored; failure → `RESTOCK_PENDING` | consistent after reconcile |

## Known limitations (be upfront in the viva)

- **Eventual, not instant, consistency:** between a crash and the next reconcile run, stock can be temporarily too low (never too high). We prefer under-selling to over-selling.
- **At-least-once release:** if the app crashes *between* releasing stock and marking the saga, the reconciler could release the same stock twice. A production system would add a `released` flag in the same atomic update as the stock change (Mongo multi-document transaction, needs a replica set).
- **Stock is a soft reservation**, not a payment (customers pay at the counter in this project).
- Reserving several items is atomic **per item**, not across the whole cart; failed carts are un-done by compensation.
- Deleted/renamed menu items never break old orders because name and price are **snapshotted** in `order_items`.
- Reconcile only cleans sagas older than 2 minutes, so it never touches orders still being processed.

## Where to look in the code

| Concept | File |
|---|---|
| Saga steps + compensation + reconciler | `lib/services/orderSaga.ts` |
| Atomic stock reserve / release | `lib/mongo/menuRepo.ts` (`reserveStock`, `releaseStock`) |
| Saga log collection | `lib/mongo/sagaRepo.ts` |
| Idempotent insert + slot lock (placeholder) | `lib/postgres/placeholderAdapter.ts` → `createOrder` |
| Failure tests (fakes with injected faults) | `tests/saga.test.ts` |
