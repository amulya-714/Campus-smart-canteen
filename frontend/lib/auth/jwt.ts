import { SignJWT, jwtVerify } from 'jose';
import { env, SESSION_DAYS } from '@/lib/config';
import type { Role, Session } from '@/lib/types';

const secret = () => {
  const s = env('JWT_SECRET');
  if (s.length < 16) throw new Error('JWT_SECRET must be at least 16 characters');
  return new TextEncoder().encode(s);
};

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.role, name: s.name, stallId: s.stallId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(s.userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: Number(payload.sub),
      role: payload.role as Role,
      name: String(payload.name),
      stallId: (payload.stallId as number | null) ?? null,
    };
  } catch {
    return null; // expired, tampered, wrong secret...
  }
}
