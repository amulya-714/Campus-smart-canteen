/**
 * Role-based access control (RBAC) middleware for API routes.
 *
 *   export const GET = withAuth(['admin'], async (req, { session }) => ...)
 *
 * - No/invalid cookie  -> 401
 * - Valid cookie, wrong role -> 403
 * `withAuth(null, ...)` = any logged-in user.
 */
import type { NextRequest } from 'next/server';
import { JWT_COOKIE } from '@/lib/config';
import { ApiError, errorResponse } from '@/lib/http';
import type { Role, Session } from '@/lib/types';
import { verifySession } from './jwt';

export async function getSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(JWT_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

export function requireRole(session: Session | null, roles: Role[] | null): Session {
  if (!session) throw new ApiError(401, 'Please log in first');
  if (roles && !roles.includes(session.role)) throw new ApiError(403, 'You do not have access to this');
  return session;
}

type Ctx<P> = { params: P };
type Handler<P> = (req: NextRequest, ctx: { session: Session; params: P }) => Promise<Response>;

export function withAuth<P = Record<string, string>>(roles: Role[] | null, handler: Handler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const session = requireRole(await getSession(req), roles);
      return await handler(req, { session, params: ctx?.params });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** For routes that must work without login (register/login, public menus). */
export function open<P = Record<string, string>>(handler: (req: NextRequest, ctx: Ctx<P>) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try { return await handler(req, ctx); } catch (e) { return errorResponse(e); }
  };
}

/** Staff can only touch their own stall; admin can touch any. */
export function assertStallAccess(session: Session, stallId: number) {
  if (session.role === 'admin') return;
  if (session.role === 'staff' && session.stallId === stallId) return;
  throw new ApiError(403, 'You can only manage your own stall');
}
