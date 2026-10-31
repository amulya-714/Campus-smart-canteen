import { json } from '@/lib/http';
import { open } from '@/lib/auth/guard';
import { getRankedStalls } from '@/lib/services/stallsService';

// Public: stalls with current load + availability, best-ranked first.
export const GET = open(async () => json({ stalls: await getRankedStalls() }));

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
