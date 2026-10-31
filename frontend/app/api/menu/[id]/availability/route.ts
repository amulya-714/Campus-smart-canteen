import { z } from 'zod';
import { json, readJson, ApiError } from '@/lib/http';
import { withAuth, assertStallAccess } from '@/lib/auth/guard';
import { getMenuItem, setAvailability } from '@/lib/mongo/menuRepo';

const body = z.object({ is_available: z.boolean() });

// Toggle "available / sold out" with one click.
export const PATCH = withAuth<{ id: string }>(['staff', 'admin'], async (req, { session, params }) => {
  const { is_available } = body.parse(await readJson(req));
  const existing = await getMenuItem(params.id);
  if (!existing) throw new ApiError(404, 'Menu item not found');
  assertStallAccess(session, existing.stall_id);
  return json({ item: await setAvailability(params.id, is_available) });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
