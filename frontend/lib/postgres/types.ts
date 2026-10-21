/**
 * THE INTEGRATION CONTRACT (TypeScript side).
 *
 * Everything Person 2's code needs from PostgreSQL goes through this interface.
 * Person 1 can swap in their real implementation by implementing `PgAdapter`
 * (see lib/postgres/index.ts). No other file imports `pg` directly.
 * Full description: docs/INTEGRATION_CONTRACT.md
 */
import type {
  Order, OrderItem, OrderStatus, Role, Slot, Stall, StallLoad, User,
} from '@/lib/types';

export class SlotFullError extends Error {
  constructor() { super('That pickup slot is full'); this.name = 'SlotFullError'; }
}
export class SlotUnavailableError extends Error {
  constructor(msg = 'That pickup slot is not available') { super(msg); this.name = 'SlotUnavailableError'; }
}
export class DuplicateEmailError extends Error {
  constructor() { super('Email already registered'); this.name = 'DuplicateEmailError'; }
}

export interface CreateOrderInput {
  requestId: string; // idempotency key
  studentId: number;
  stallId: number;
  slotId: number;
  items: OrderItem[]; // already validated + snapshotted from MongoDB
  totalAmount: number;
}

export interface DailyCount { date: string; stallId: number; orders: number }

export interface PgAdapter {
  // ---- users ----
  createUser(i: { name: string; email: string; passwordHash: string; role: Role; stallId?: number | null }): Promise<User>;
  findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  findUserById(id: number): Promise<User | null>;
  listStaff(): Promise<(User & { stallName: string | null })[]>;
  deleteUser(id: number, role: Role): Promise<boolean>;

  // ---- stalls ----
  listStalls(opts?: { includeInactive?: boolean }): Promise<Stall[]>;
  getStall(id: number): Promise<Stall | null>;
  createStall(i: { name: string; location: string; description: string }): Promise<Stall>;
  deactivateStall(id: number): Promise<boolean>; // "remove" = soft delete (orders keep history)

  // ---- slots ----
  listOpenSlots(stallId: number): Promise<Slot[]>;
  getSlotUtilization(stallId?: number): Promise<Slot[]>; // today's slots

  // ---- orders (Person 1's book_slot + create_order live behind createOrder) ----
  createOrder(i: CreateOrderInput): Promise<Order>; // atomic: lock slot, check capacity, insert, increment. Throws SlotFullError
  cancelOrder(orderId: number, studentId?: number): Promise<Order | null>; // frees the slot; null if not cancellable
  getOrder(orderId: number): Promise<Order | null>;
  getOrderByRequestId(requestId: string): Promise<Order | null>;
  listOrdersByStudent(studentId: number): Promise<Order[]>;
  listOrdersByStall(stallId: number, statuses?: OrderStatus[]): Promise<Order[]>;
  listAllOrders(limit?: number): Promise<Order[]>;
  updateOrderStatus(orderId: number, status: OrderStatus, stallId?: number): Promise<Order | null>;

  // ---- analytics ----
  getStallLoad(): Promise<StallLoad[]>;
  getDailyOrderCounts(days: number): Promise<DailyCount[]>;
}
