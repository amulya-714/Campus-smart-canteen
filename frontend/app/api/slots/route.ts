import { z } from 'zod';
import { json } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { db } from '@/lib/postgres';

const q = z.object({ stallId: z.coerce.number().int().positive() });

export const GET = withAuth(null, async (req) => {
  const { stallId } = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json({ slots: await db.listOpenSlots(stallId) });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
