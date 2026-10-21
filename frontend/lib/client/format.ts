import type { MenuItem } from '@/lib/types';

export const rupees = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
export const timeOf = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

export function isVeg(item: MenuItem): boolean {
  return item.attributes.is_veg !== false; // juices have no is_veg and are veg
}

/** One readable line built from the category-specific attributes. */
export function describeItem(item: MenuItem): string {
  const a = item.attributes as Record<string, any>;
  switch (item.category) {
    case 'juice': return `${a.size} · ${a.sugar_level === 'none' ? 'no sugar' : `${a.sugar_level} sugar`}`;
    case 'sandwich': return `${a.bread_type} bread${a.is_spicy ? ' · spicy' : ''}${a.add_ons?.length ? ` · + ${a.add_ons.join(', ')}` : ''}`;
    case 'snack': return `${a.portion} portion`;
    case 'combo': return `Includes ${(a.combo_items ?? []).join(' + ')}`;
  }
}
