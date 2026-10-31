import type { NextResponse } from 'next/server';
import { JWT_COOKIE, SESSION_DAYS } from '@/lib/config';

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(JWT_COOKIE, token, {
    httpOnly: true, // JavaScript in the browser cannot read it (blocks XSS token theft)
    sameSite: 'lax', // blocks most cross-site request forgery
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}
export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(JWT_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}
