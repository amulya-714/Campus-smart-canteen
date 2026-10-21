import { NextResponse } from 'next/server';
import { db, DuplicateEmailError } from '@/lib/postgres';
import { hashPassword } from '@/lib/auth/password';
import { signSession } from '@/lib/auth/jwt';
import { setSessionCookie } from '@/lib/auth/cookies';
import { registerSchema } from '@/lib/auth/validation';
import { ApiError, readJson } from '@/lib/http';
import { open } from '@/lib/auth/guard';

// Public sign-up always creates a STUDENT. Staff are created by an admin.
export const POST = open(async (req) => {
  const body = registerSchema.parse(await readJson(req));
  try {
    const user = await db.createUser({ name: body.name, email: body.email, passwordHash: await hashPassword(body.password), role: 'student' });
    const res = NextResponse.json({ user }, { status: 201 });
    setSessionCookie(res, await signSession({ userId: user.id, name: user.name, role: user.role, stallId: null }));
    return res;
  } catch (e) {
    if (e instanceof DuplicateEmailError) throw new ApiError(409, 'That email is already registered');
    throw e;
  }
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
