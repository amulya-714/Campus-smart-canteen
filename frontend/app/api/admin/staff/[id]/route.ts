import { json, ApiError } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { db } from '@/lib/postgres';

export const DELETE = withAuth<{ id: string }>(['admin'], async (_req, { params }) => {
  if (!(await db.deleteUser(Number(params.id), 'staff'))) throw new ApiError(404, 'Staff account not found');
  return json({ ok: true });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
