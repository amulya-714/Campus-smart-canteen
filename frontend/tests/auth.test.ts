import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/postgres', () => {
  class DuplicateEmailError extends Error {}
  return {
    DuplicateEmailError,
    db: { createUser: vi.fn(), findUserByEmail: vi.fn(), listStaff: vi.fn() },
  };
});

import { db, DuplicateEmailError } from '@/lib/postgres';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { signSession, verifySession } from '@/lib/auth/jwt';
import { requireRole } from '@/lib/auth/guard';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as me } from '@/app/api/auth/me/route';
import { GET as adminStaff } from '@/app/api/admin/staff/route';
import { makeReq, tokenFor } from './helpers';

const mdb = db as unknown as Record<'createUser' | 'findUserByEmail' | 'listStaff', ReturnType<typeof vi.fn>>;
const ctx = { params: {} as Record<string, string> };
beforeEach(() => vi.resetAllMocks());

describe('password hashing', () => {
  it('stores a salted bcrypt hash, never the password', async () => {
    const h1 = await hashPassword('Secret123'), h2 = await hashPassword('Secret123');
    expect(h1).not.toContain('Secret123');
    expect(h1).not.toBe(h2); // different salt each time
    expect(h1.startsWith('$2')).toBe(true);
    expect(await verifyPassword('Secret123', h1)).toBe(true);
    expect(await verifyPassword('wrong', h1)).toBe(false);
  });
});

describe('JWT session', () => {
  it('round-trips and rejects tampered tokens', async () => {
    const t = await signSession({ userId: 5, name: 'A', role: 'staff', stallId: 2 });
    expect(await verifySession(t)).toEqual({ userId: 5, name: 'A', role: 'staff', stallId: 2 });
    expect(await verifySession(t.slice(0, -3) + 'abc')).toBeNull();
    expect(await verifySession('garbage')).toBeNull();
  });
});

describe('requireRole', () => {
  it('401 without session, 403 for wrong role, passes for right role', () => {
    expect(() => requireRole(null, ['admin'])).toThrowError(/log in/);
    const s = { userId: 1, name: 'x', role: 'student' as const, stallId: null };
    expect(() => requireRole(s, ['admin'])).toThrowError(/access/);
    expect(requireRole(s, ['student', 'staff'])).toBe(s);
    expect(requireRole(s, null)).toBe(s);
  });
});

describe('POST /api/auth/register', () => {
  const good = { name: 'Asha K', email: 'Asha@College.edu', password: 'Passw0rdX' };

  it('creates a STUDENT, hashes password, sets httpOnly cookie, hides hash', async () => {
    mdb.createUser.mockImplementation(async (i: any) => ({ id: 9, name: i.name, email: i.email, role: i.role, stallId: null }));
    const res = await register(makeReq('/api/auth/register', { method: 'POST', body: good }), ctx);
    expect(res.status).toBe(201);
    const arg = mdb.createUser.mock.calls[0][0];
    expect(arg.role).toBe('student');
    expect(arg.email).toBe('asha@college.edu');
    expect(arg.passwordHash).not.toContain('Passw0rdX');
    expect(res.headers.get('set-cookie')).toMatch(/cb_token=.+HttpOnly/i);
    expect(JSON.stringify(await res.json())).not.toMatch(/hash|Passw0rdX/i);
  });

  it('rejects an attempt to self-register as admin', async () => {
    const res = await register(makeReq('/api/auth/register', { method: 'POST', body: { ...good, role: 'admin' } }), ctx);
    expect(res.status).toBe(400);
    expect(mdb.createUser).not.toHaveBeenCalled();
  });

  it('rejects weak passwords and bad emails', async () => {
    for (const bad of [{ ...good, password: 'short1' }, { ...good, password: 'noDigitsHere' }, { ...good, email: 'nope' }]) {
      expect((await register(makeReq('/api/auth/register', { method: 'POST', body: bad }), ctx)).status).toBe(400);
    }
  });

  it('returns 409 for a duplicate email', async () => {
    mdb.createUser.mockRejectedValue(new DuplicateEmailError());
    expect((await register(makeReq('/api/auth/register', { method: 'POST', body: good }), ctx)).status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with the right password and sets the cookie', async () => {
    mdb.findUserByEmail.mockResolvedValue({ id: 3, name: 'S', email: 's@x.io', role: 'student', stallId: null, passwordHash: await hashPassword('Passw0rdX') });
    const res = await login(makeReq('/api/auth/login', { method: 'POST', body: { email: 's@x.io', password: 'Passw0rdX' } }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/cb_token=/);
    expect(JSON.stringify(await res.json())).not.toMatch(/passwordHash/);
  });

  it('gives the SAME 401 for wrong password and unknown email', async () => {
    mdb.findUserByEmail.mockResolvedValueOnce({ id: 3, name: 'S', email: 'a@x.io', role: 'student', stallId: null, passwordHash: await hashPassword('Passw0rdX') });
    const wrongPw = await login(makeReq('/api/auth/login', { method: 'POST', body: { email: 'a@x.io', password: 'nope-nope1' } }), ctx);
    mdb.findUserByEmail.mockResolvedValueOnce(null);
    const noUser = await login(makeReq('/api/auth/login', { method: 'POST', body: { email: 'ghost@x.io', password: 'nope-nope1' } }), ctx);
    expect(wrongPw.status).toBe(401); expect(noUser.status).toBe(401);
    expect((await wrongPw.json()).error).toBe((await noUser.json()).error);
  });

  it('rate-limits repeated guesses', async () => {
    mdb.findUserByEmail.mockResolvedValue(null);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await login(makeReq('/api/auth/login', { method: 'POST', body: { email: 'brute@x.io', password: 'guess-guess1' } }), ctx)).status;
    expect(last).toBe(429);
  });
});

describe('GET /api/auth/me and role-protected routes', () => {
  it('me returns null user when logged out', async () => {
    expect((await (await me(makeReq('/api/auth/me'), ctx)).json()).user).toBeNull();
  });
  it('me returns the user from a valid cookie', async () => {
    const j = await (await me(makeReq('/api/auth/me', { token: await tokenFor('staff', 2) }), ctx)).json();
    expect(j.user).toMatchObject({ role: 'staff', stallId: 2 });
  });
  it('admin API: 401 anonymous, 403 student/staff, 200 admin', async () => {
    mdb.listStaff.mockResolvedValue([]);
    expect((await adminStaff(makeReq('/api/admin/staff'), ctx)).status).toBe(401);
    expect((await adminStaff(makeReq('/api/admin/staff', { token: await tokenFor('student') }), ctx)).status).toBe(403);
    expect((await adminStaff(makeReq('/api/admin/staff', { token: await tokenFor('staff', 1) }), ctx)).status).toBe(403);
    expect((await adminStaff(makeReq('/api/admin/staff', { token: await tokenFor('admin') }), ctx)).status).toBe(200);
  });
  it('rejects an expired/forged cookie', async () => {
    expect((await adminStaff(makeReq('/api/admin/staff', { token: 'forged.token.value' }), ctx)).status).toBe(401);
  });
});
