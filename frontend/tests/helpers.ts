import { NextRequest } from 'next/server';
import { signSession } from '@/lib/auth/jwt';
import type { Role } from '@/lib/types';

export async function tokenFor(role: Role, stallId: number | null = null, userId = 1) {
  return signSession({ userId, name: `Test ${role}`, role, stallId });
}

export function makeReq(url: string, opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `cb_token=${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
