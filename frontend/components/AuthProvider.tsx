'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import type { Role } from '@/lib/types';

export interface Me { id: number; name: string; role: Role; stallId: number | null }
interface Ctx { user: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const AuthCtx = createContext<Ctx>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export const homeFor = (r: Role) => (r === 'admin' ? '/admin' : r === 'staff' ? '/staff' : '/student');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setUser((await api<{ user: Me | null }>('/api/auth/me')).user); } catch { setUser(null); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = useCallback(async () => { await api('/api/auth/logout', { method: 'POST' }); setUser(null); }, []);
  return <AuthCtx.Provider value={{ user, loading, refresh, logout }}>{children}</AuthCtx.Provider>;
}

/** Page guard: sends logged-out users to /login and wrong-role users to their own home. */
export function useRequireRole(role: Role): Me | null {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role !== role) router.replace(homeFor(user.role));
  }, [user, loading, role, router]);
  return user && user.role === role ? user : null;
}
