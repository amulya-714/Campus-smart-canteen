import { json, ApiError } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { db } from '@/lib/postgres';

// "Remove" = deactivate: the stall disappears for students, but past orders keep their history.
export const DELETE = withAuth<{ id: string }>(['admin'], async (_req, { params }) => {
  if (!(await db.deactivateStall(Number(params.id)))) throw new ApiError(404, 'Stall not found');
  return json({ ok: true });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
