import { z } from 'zod';
import { json, readJson } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { db } from '@/lib/postgres';

const body = z.object({
  name: z.string().trim().min(2).max(80),
  location: z.string().trim().max(120).default(''),
  description: z.string().trim().max(300).default(''),
});

export const GET = withAuth(['admin'], async () => json({ stalls: await db.listStalls({ includeInactive: true }) }));

export const POST = withAuth(['admin'], async (req) =>
  json({ stall: await db.createStall(body.parse(await readJson(req))) }, 201));

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
