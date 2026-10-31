import { NextResponse } from 'next/server';
import { db } from '@/lib/postgres';
import { verifyPassword } from '@/lib/auth/password';
import { signSession } from '@/lib/auth/jwt';
import { setSessionCookie } from '@/lib/auth/cookies';
import { loginSchema } from '@/lib/auth/validation';
import { tooManyAttempts, resetAttempts } from '@/lib/auth/rateLimit';
import { ApiError, readJson } from '@/lib/http';
import { open } from '@/lib/auth/guard';

export const POST = open(async (req) => {
  const { email, password } = loginSchema.parse(await readJson(req));
  const key = `${email}|${req.headers.get('x-forwarded-for') ?? 'local'}`;
  if (tooManyAttempts(key)) throw new ApiError(429, 'Too many attempts. Wait a minute and try again.');

  const found = await db.findUserByEmail(email);
  // Same message for "no such user" and "wrong password" so attackers can't probe which emails exist.
  if (!found || !(await verifyPassword(password, found.passwordHash))) throw new ApiError(401, 'Wrong email or password');
  resetAttempts(key);

  const { passwordHash: _omit, ...user } = found; // never send the hash to the browser
  const res = NextResponse.json({ user });
  setSessionCookie(res, await signSession({ userId: user.id, name: user.name, role: user.role, stallId: user.stallId }));
  return res;
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
