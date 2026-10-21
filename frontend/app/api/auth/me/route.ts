import { NextResponse } from 'next/server';
import { getSession, open } from '@/lib/auth/guard';

export const GET = open(async (req) => {
  const s = await getSession(req);
  // 200 with user:null (not 401) so the frontend can ask "who am I?" without console errors.
  return NextResponse.json({ user: s ? { id: s.userId, name: s.name, role: s.role, stallId: s.stallId } : null });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
