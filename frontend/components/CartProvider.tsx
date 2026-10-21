'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MenuItem } from '@/lib/types';

export interface CartLine { item: MenuItem; qty: number }
interface Cart {
  stallId: number | null; stallName: string; lines: CartLine[]; count: number; total: number;
  add: (item: MenuItem, stallName: string) => 'ok' | 'other-stall';
  setQty: (id: string, qty: number) => void; clear: () => void; replaceWith: (item: MenuItem, stallName: string) => void;
}
const C = createContext<Cart | null>(null);
export const useCart = () => { const c = useContext(C); if (!c) throw new Error('CartProvider missing'); return c; };
const KEY = 'campusbite.cart';

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ stallId: number | null; stallName: string; lines: CartLine[] }>({ stallId: null, stallName: '', lines: [] });
  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) setState(JSON.parse(s)); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }, [state]);

  const add: Cart['add'] = (item, stallName) => {
    if (state.stallId && state.stallId !== item.stall_id && state.lines.length) return 'other-stall'; // one stall per order = one pickup slot
    setState((s) => {
      const ex = s.lines.find((l) => l.item._id === item._id);
      const lines = ex ? s.lines.map((l) => (l.item._id === item._id ? { ...l, qty: Math.min(10, l.qty + 1) } : l)) : [...s.lines, { item, qty: 1 }];
      return { stallId: item.stall_id, stallName, lines };
    });
    return 'ok';
  };
  const setQty = (id: string, qty: number) => setState((s) => {
    const lines = s.lines.filter((l) => l.item._id !== id || qty > 0).map((l) => (l.item._id === id ? { ...l, qty: Math.min(10, qty) } : l));
    return { ...s, lines, stallId: lines.length ? s.stallId : null };
  });
  const clear = () => setState({ stallId: null, stallName: '', lines: [] });
  const replaceWith = (item: MenuItem, stallName: string) => setState({ stallId: item.stall_id, stallName, lines: [{ item, qty: 1 }] });

  const count = state.lines.reduce((n, l) => n + l.qty, 0);
  const total = state.lines.reduce((n, l) => n + l.qty * l.item.price, 0);
  return <C.Provider value={{ ...state, count, total, add, setQty, clear, replaceWith }}>{children}</C.Provider>;
}
