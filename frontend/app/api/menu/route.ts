import { z } from 'zod';
import { json, readJson } from '@/lib/http';
import { open, withAuth, assertStallAccess } from '@/lib/auth/guard';
import { createMenuItem, listMenu } from '@/lib/mongo/menuRepo';
import { menuItemSchema } from '@/lib/mongo/schemas';
import { CATEGORIES } from '@/lib/types';
import { getRankedStalls } from '@/lib/services/stallsService';
import { rankItems } from '@/lib/services/ranking';

const querySchema = z.object({
  stallId: z.coerce.number().int().positive().optional(),
  category: z.enum(CATEGORIES as [string, ...string[]]).optional(),
  q: z.string().trim().max(60).optional(),
  veg: z.enum(['1', '0']).optional(),
  all: z.enum(['1', '0']).optional(), // all=1 -> include sold-out / switched-off items (staff view)
});

// Public: list / search menus. Without stallId, results are demand-aware ranked.
export const GET = open(async (req) => {
  const p = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const items = await listMenu({
    stallId: p.stallId, category: p.category as never, q: p.q || undefined,
    vegOnly: p.veg === '1', availableOnly: p.all !== '1',
  });
  if (p.stallId) return json({ items: items.map(({ textScore: _t, ...i }) => i) });

  const scores = new Map((await getRankedStalls()).map((s) => [s.id, s.score]));
  return json({ items: rankItems(items, scores) });
});

// Staff (own stall) or admin: create an item.
export const POST = withAuth(['staff', 'admin'], async (req, { session }) => {
  const body = await readJson(req) as Record<string, unknown>;
  // Staff don't need to send stall_id: default to their own stall.
  const input = menuItemSchema.parse({ ...body, stall_id: body.stall_id ?? session.stallId });
  assertStallAccess(session, input.stall_id);
  return json({ item: await createMenuItem(input) }, 201);
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
