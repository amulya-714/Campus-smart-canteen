import { menuItemSchema, menuUpdateSchema, type MenuItemInput } from '@/lib/mongo/schemas';
import type { MenuItem } from '@/lib/types';

/**
 * Applies a partial update to an existing item, then re-validates the WHOLE
 * result with the category's schema (so you can't, say, give a juice a bread_type).
 * `category` and `stall_id` are never changed.
 */
export function applyMenuUpdate(existing: MenuItem, patchRaw: unknown): MenuItemInput {
  const patch = menuUpdateSchema.parse(patchRaw);
  const { _id, ...rest } = existing;
  return menuItemSchema.parse({
    ...rest,
    ...patch,
    attributes: patch.attributes ? { ...existing.attributes, ...patch.attributes } : existing.attributes,
  });
}
