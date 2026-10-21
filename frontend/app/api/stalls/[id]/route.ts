import { json, ApiError } from '@/lib/http';
import { open } from '@/lib/auth/guard';
import { getRankedStalls } from '@/lib/services/stallsService';

export const GET = open<{ id: string }>(async (_req, { params }) => {
  const stall = (await getRankedStalls()).find((s) => s.id === Number(params.id));
  if (!stall) throw new ApiError(404, 'Stall not found');
  return json({ stall });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
