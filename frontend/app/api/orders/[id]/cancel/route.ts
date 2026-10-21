import { json } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { cancelOrder } from '@/lib/services/orderSaga';
import { sagaDeps } from '@/lib/services/defaultDeps';

export const POST = withAuth<{ id: string }>(['student'], async (_req, { session, params }) =>
  json({ order: await cancelOrder(Number(params.id), session.userId, sagaDeps) }));

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
