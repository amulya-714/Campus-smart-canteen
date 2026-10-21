import { json } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { getForecast } from '@/lib/services/forecast';

// Staff see only their own stall's forecast; admin sees all stalls.
export const GET = withAuth(['staff', 'admin'], async (_req, { session }) =>
  json(await getForecast(session.role === 'staff' ? (session.stallId ?? -1) : undefined)));

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
