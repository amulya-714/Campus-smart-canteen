import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/cookies';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
