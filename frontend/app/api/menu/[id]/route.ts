import { json, readJson, ApiError } from '@/lib/http';
import { open, withAuth, assertStallAccess } from '@/lib/auth/guard';
import { deleteMenuItem, getMenuItem, replaceMenuItem } from '@/lib/mongo/menuRepo';
import { applyMenuUpdate } from '@/lib/services/menuService';

export const GET = open<{ id: string }>(async (_req, { params }) => {
  const item = await getMenuItem(params.id);
  if (!item) throw new ApiError(404, 'Menu item not found');
  return json({ item });
});

export const PUT = withAuth<{ id: string }>(['staff', 'admin'], async (req, { session, params }) => {
  const existing = await getMenuItem(params.id);
  if (!existing) throw new ApiError(404, 'Menu item not found');
  assertStallAccess(session, existing.stall_id);
  const updated = await replaceMenuItem(params.id, applyMenuUpdate(existing, await readJson(req)));
  return json({ item: updated });
});

export const DELETE = withAuth<{ id: string }>(['staff', 'admin'], async (_req, { session, params }) => {
  const existing = await getMenuItem(params.id);
  if (!existing) throw new ApiError(404, 'Menu item not found');
  assertStallAccess(session, existing.stall_id);
  await deleteMenuItem(params.id); // old orders keep their own name/price snapshot, so history is safe
  return json({ ok: true });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
