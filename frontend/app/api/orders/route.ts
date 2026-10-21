import { z } from 'zod';
import { json, readJson } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { db } from '@/lib/postgres';
import { placeOrder } from '@/lib/services/orderSaga';
import { sagaDeps } from '@/lib/services/defaultDeps';
import { ORDER_STATUSES } from '@/lib/types';

const placeSchema = z.object({
  requestId: z.string().uuid(), // the browser makes one per checkout attempt (idempotency key)
  stallId: z.number().int().positive(),
  slotId: z.number().int().positive(),
  items: z.array(z.object({ menuItemId: z.string().length(24), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
});

export const POST = withAuth(['student'], async (req, { session }) => {
  const b = placeSchema.parse(await readJson(req));
  // studentId comes from the signed cookie, NEVER from the request body.
  const order = await placeOrder({ ...b, studentId: session.userId }, sagaDeps);
  return json({ order }, 201);
});

// Students -> their own orders. Staff -> their stall's orders. Admin -> everything.
export const GET = withAuth(null, async (req, { session }) => {
  if (session.role === 'student') return json({ orders: await db.listOrdersByStudent(session.userId) });
  if (session.role === 'staff') {
    const raw = new URL(req.url).searchParams.get('status');
    const statuses = raw ? z.array(z.enum(ORDER_STATUSES as [string, ...string[]])).parse(raw.split(',')) : undefined;
    return json({ orders: await db.listOrdersByStall(session.stallId ?? -1, statuses as never) });
  }
  return json({ orders: await db.listAllOrders(200) });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
