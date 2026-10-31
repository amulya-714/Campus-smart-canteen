/**
 * PLACEHOLDER adapter -- Person 1 will replace this (or re-implement the same methods).
 * It is written against db/placeholder_schema.sql and is just good enough to
 * demo and test Person 2's part locally. The interesting concurrency logic
 * (row locking, isolation levels, triggers) is Person 1's job; the version
 * here uses a simple SELECT ... FOR UPDATE inside one transaction.
 */
import type { PoolClient } from 'pg';
import type { Order, OrderStatus, Role, Slot, Stall, User } from '@/lib/types';
import { pool } from './client';
import {
  DuplicateEmailError, SlotFullError, SlotUnavailableError,
  type CreateOrderInput, type DailyCount, type PgAdapter,
} from './types';

const toUser = (r: any): User => ({ id: r.user_id, name: r.name, email: r.email, role: r.role, stallId: r.stall_id });
const toStall = (r: any): Stall => ({ id: r.stall_id, name: r.name, location: r.location, description: r.description, isActive: r.is_active });
const toSlot = (r: any): Slot => ({
  id: r.slot_id, stallId: r.stall_id, start: new Date(r.slot_start).toISOString(),
  end: new Date(r.slot_end).toISOString(), capacity: r.capacity, booked: r.booked_count,
});
const toOrder = (r: any): Order => ({
  id: r.order_id, requestId: r.client_request_id, studentId: r.student_id, studentName: r.student_name,
  stallId: r.stall_id, stallName: r.stall_name, slotId: r.slot_id,
  slotStart: r.slot_start ? new Date(r.slot_start).toISOString() : undefined,
  status: r.status, totalAmount: Number(r.total_amount), createdAt: new Date(r.created_at).toISOString(),
  items: (r.items ?? []).map((i: any) => ({ menuItemId: i.menu_item_id, name: i.name, unitPrice: Number(i.unit_price), quantity: i.quantity })),
});

// One SELECT that returns an order with its items as JSON (avoids N+1 queries).
const ORDER_SELECT = `
  SELECT o.*, s.name AS stall_name, u.name AS student_name, ps.slot_start,
    COALESCE((SELECT json_agg(json_build_object('menu_item_id', i.menu_item_id, 'name', i.item_name,
              'unit_price', i.unit_price::float8, 'quantity', i.quantity) ORDER BY i.order_item_id)
              FROM order_items i WHERE i.order_id = o.order_id), '[]'::json) AS items
  FROM orders o
  JOIN stalls s ON s.stall_id = o.stall_id
  JOIN users u ON u.user_id = o.student_id
  JOIN pickup_slots ps ON ps.slot_id = o.slot_id`;

async function orderById(q: Pick<PoolClient, 'query'>, id: number): Promise<Order | null> {
  const r = await q.query(`${ORDER_SELECT} WHERE o.order_id = $1`, [id]);
  return r.rows[0] ? toOrder(r.rows[0]) : null;
}

export class PlaceholderPgAdapter implements PgAdapter {
  // ---------- users ----------
  async createUser(i: { name: string; email: string; passwordHash: string; role: Role; stallId?: number | null }) {
    try {
      const r = await pool().query(
        `INSERT INTO users (name, email, password_hash, role, stall_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [i.name, i.email.toLowerCase(), i.passwordHash, i.role, i.stallId ?? null]);
      return toUser(r.rows[0]);
    } catch (e: any) {
      if (e.code === '23505') throw new DuplicateEmailError(); // unique violation
      throw e;
    }
  }
  async findUserByEmail(email: string) {
    const r = await pool().query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
    return r.rows[0] ? { ...toUser(r.rows[0]), passwordHash: r.rows[0].password_hash as string } : null;
  }
  async findUserById(id: number) {
    const r = await pool().query(`SELECT * FROM users WHERE user_id = $1`, [id]);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }
  async listStaff() {
    const r = await pool().query(
      `SELECT u.*, s.name AS stall_name FROM users u LEFT JOIN stalls s USING (stall_id) WHERE u.role = 'staff' ORDER BY u.user_id`);
    return r.rows.map((x) => ({ ...toUser(x), stallName: x.stall_name as string | null }));
  }
  async deleteUser(id: number, role: Role) {
    try {
      const r = await pool().query(`DELETE FROM users WHERE user_id = $1 AND role = $2`, [id, role]);
      return (r.rowCount ?? 0) > 0;
    } catch (e: any) {
      if (e.code === '23503') return false; // has orders -> keep for history
      throw e;
    }
  }

  // ---------- stalls ----------
  async listStalls(opts?: { includeInactive?: boolean }) {
    const r = await pool().query(`SELECT * FROM stalls ${opts?.includeInactive ? '' : 'WHERE is_active'} ORDER BY stall_id`);
    return r.rows.map(toStall);
  }
  async getStall(id: number) {
    const r = await pool().query(`SELECT * FROM stalls WHERE stall_id = $1`, [id]);
    return r.rows[0] ? toStall(r.rows[0]) : null;
  }
  async createStall(i: { name: string; location: string; description: string }) {
    const r = await pool().query(`INSERT INTO stalls (name, location, description) VALUES ($1,$2,$3) RETURNING *`, [i.name, i.location, i.description]);
    await pool().query(`SELECT placeholder_generate_slots(2)`);
    return toStall(r.rows[0]);
  }
  async deactivateStall(id: number) {
    const r = await pool().query(`UPDATE stalls SET is_active = FALSE WHERE stall_id = $1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  // ---------- slots ----------
  async listOpenSlots(stallId: number) {
    const r = await pool().query(
      `SELECT * FROM pickup_slots WHERE stall_id = $1 AND slot_start > now() ORDER BY slot_start LIMIT 36`, [stallId]);
    return r.rows.map(toSlot);
  }
  async getSlotUtilization(stallId?: number) {
    const r = await pool().query(
      `SELECT * FROM pickup_slots WHERE slot_start >= date_trunc('day', now()) AND slot_start < date_trunc('day', now()) + interval '1 day'
       ${stallId ? 'AND stall_id = $1' : ''} ORDER BY slot_start`, stallId ? [stallId] : []);
    return r.rows.map(toSlot);
  }

  // ---------- orders ----------
  async createOrder(i: CreateOrderInput): Promise<Order> {
    const c = await pool().connect();
    try {
      await c.query('BEGIN');
      // Row lock: two students booking the same slot are serialized here.
      const slot = (await c.query(`SELECT * FROM pickup_slots WHERE slot_id = $1 FOR UPDATE`, [i.slotId])).rows[0];
      if (!slot || slot.stall_id !== i.stallId) throw new SlotUnavailableError('Slot not found for this stall');
      if (new Date(slot.slot_start) <= new Date()) throw new SlotUnavailableError('That pickup time has already started');
      if (slot.booked_count >= slot.capacity) throw new SlotFullError();

      const ins = await c.query(
        `INSERT INTO orders (client_request_id, student_id, stall_id, slot_id, total_amount)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (client_request_id) DO NOTHING RETURNING order_id`,
        [i.requestId, i.studentId, i.stallId, i.slotId, i.totalAmount]);
      if (!ins.rows[0]) { // same request sent twice -> return the first result (idempotent)
        await c.query('ROLLBACK');
        return (await this.getOrderByRequestId(i.requestId))!;
      }
      const orderId: number = ins.rows[0].order_id;
      for (const it of i.items) {
        await c.query(`INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)`,
          [orderId, it.menuItemId, it.name, it.unitPrice, it.quantity]);
      }
      await c.query(`UPDATE pickup_slots SET booked_count = booked_count + 1 WHERE slot_id = $1`, [i.slotId]);
      await c.query('COMMIT');
      return (await orderById(pool(), orderId))!;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  async cancelOrder(orderId: number, studentId?: number) {
    const c = await pool().connect();
    try {
      await c.query('BEGIN');
      const o = (await c.query(
        `SELECT * FROM orders WHERE order_id = $1 ${studentId ? 'AND student_id = $2' : ''} FOR UPDATE`,
        studentId ? [orderId, studentId] : [orderId])).rows[0];
      if (!o || o.status !== 'PLACED') { await c.query('ROLLBACK'); return null; } // only before cooking starts
      await c.query(`UPDATE orders SET status = 'CANCELLED', updated_at = now() WHERE order_id = $1`, [orderId]);
      await c.query(`UPDATE pickup_slots SET booked_count = booked_count - 1 WHERE slot_id = $1`, [o.slot_id]);
      await c.query('COMMIT');
      return await orderById(pool(), orderId);
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  async getOrder(orderId: number) { return orderById(pool(), orderId); }
  async getOrderByRequestId(requestId: string) {
    const r = await pool().query(`${ORDER_SELECT} WHERE o.client_request_id = $1`, [requestId]);
    return r.rows[0] ? toOrder(r.rows[0]) : null;
  }
  async listOrdersByStudent(studentId: number) {
    const r = await pool().query(`${ORDER_SELECT} WHERE o.student_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [studentId]);
    return r.rows.map(toOrder);
  }
  async listOrdersByStall(stallId: number, statuses?: OrderStatus[]) {
    const r = await pool().query(
      `${ORDER_SELECT} WHERE o.stall_id = $1 ${statuses ? 'AND o.status = ANY($2)' : ''} ORDER BY ps.slot_start, o.order_id LIMIT 200`,
      statuses ? [stallId, statuses] : [stallId]);
    return r.rows.map(toOrder);
  }
  async listAllOrders(limit = 100) {
    const r = await pool().query(`${ORDER_SELECT} ORDER BY o.created_at DESC LIMIT $1`, [limit]);
    return r.rows.map(toOrder);
  }
  async updateOrderStatus(orderId: number, status: OrderStatus, stallId?: number) {
    const r = await pool().query(
      `UPDATE orders SET status = $2, updated_at = now() WHERE order_id = $1 ${stallId ? 'AND stall_id = $3' : ''} RETURNING order_id`,
      stallId ? [orderId, status, stallId] : [orderId, status]);
    return r.rows[0] ? orderById(pool(), orderId) : null;
  }

  // ---------- analytics ----------
  async getStallLoad() {
    const r = await pool().query(`
      SELECT s.stall_id,
        (SELECT COUNT(*) FROM orders o WHERE o.stall_id = s.stall_id AND o.status IN ('PLACED','PREPARING'))::int AS active_orders,
        COALESCE(SUM(p.capacity)     FILTER (WHERE p.slot_start > now() AND p.slot_start < now() + interval '1 hour'), 0)::int AS cap,
        COALESCE(SUM(p.booked_count) FILTER (WHERE p.slot_start > now() AND p.slot_start < now() + interval '1 hour'), 0)::int AS booked
      FROM stalls s LEFT JOIN pickup_slots p ON p.stall_id = s.stall_id
      WHERE s.is_active GROUP BY s.stall_id ORDER BY s.stall_id`);
    return r.rows.map((x) => ({ stallId: x.stall_id, activeOrders: x.active_orders, capacityNextHour: x.cap, bookedNextHour: x.booked }));
  }
  async getDailyOrderCounts(days: number): Promise<DailyCount[]> {
    const r = await pool().query(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS d, stall_id, COUNT(*)::int AS n FROM orders
       WHERE created_at >= now() - make_interval(days => $1) AND status <> 'CANCELLED'
       GROUP BY 1, 2 ORDER BY 1, 2`, [days]);
    return r.rows.map((x) => ({ date: x.d, stallId: x.stall_id, orders: x.n }));
  }
}
