import { z } from 'zod';
import { json, readJson } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { checkCart } from '@/lib/services/orderSaga';
import { sagaDeps } from '@/lib/services/defaultDeps';

const cartSchema = z.object({
  stallId: z.number().int().positive(),
  items: z.array(z.object({ menuItemId: z.string().length(24), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
});

// Cart "API": the cart itself lives in the browser; this endpoint re-checks it
// against MongoDB (stock, price, availability) and returns the trusted prices.
export const POST = withAuth(['student'], async (req) => {
  const b = cartSchema.parse(await readJson(req));
  return json(await checkCart(b.stallId, b.items, sagaDeps));
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
