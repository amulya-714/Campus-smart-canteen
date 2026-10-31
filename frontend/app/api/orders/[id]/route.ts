import { z } from 'zod';
import { json, readJson, ApiError } from '@/lib/http';
import { withAuth, assertStallAccess } from '@/lib/auth/guard';
import { db } from '@/lib/postgres';
import type { OrderStatus } from '@/lib/types';

// Allowed moves. Cancelling is a student action (see /cancel) because it must also restock.
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['PREPARING'], PREPARING: ['READY'], READY: ['COMPLETED'], COMPLETED: [], CANCELLED: [],
};
const body = z.object({ status: z.enum(['PREPARING', 'READY', 'COMPLETED']) });

export const PATCH = withAuth<{ id: string }>(['staff', 'admin'], async (req, { session, params }) => {
  const { status } = body.parse(await readJson(req));
  const order = await db.getOrder(Number(params.id));
  if (!order) throw new ApiError(404, 'Order not found');
  assertStallAccess(session, order.stallId);
  if (!NEXT[order.status].includes(status)) throw new ApiError(409, `Cannot move an order from ${order.status} to ${status}`);
  const updated = await db.updateOrderStatus(order.id, status, session.role === 'staff' ? session.stallId ?? undefined : undefined);
  // The adapter re-checks the transition atomically; null means the order changed since we read it.
  if (!updated) throw new ApiError(409, 'Order status changed; refresh and try again');
  return json({ order: updated });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
