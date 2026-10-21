/**
 * All MongoDB reads/writes for menu items live here.
 * API routes never touch the driver directly -> easy to mock in tests.
 */
import { ObjectId, type Filter, type Document } from 'mongodb';
import { getDb } from './client';
import { MENU } from './indexes';
import type { Category, MenuItem, StallAvailability } from '@/lib/types';
import type { MenuItemInput } from './schemas';

export type MenuItemWithScore = MenuItem & { textScore?: number };

export interface MenuQuery {
  stallId?: number;
  category?: Category;
  q?: string; // free-text search
  vegOnly?: boolean;
  availableOnly?: boolean; // default true in the API
}

const toItem = (d: Document): MenuItemWithScore => ({
  _id: String(d._id), stall_id: d.stall_id, name: d.name, category: d.category, description: d.description ?? '',
  price: d.price, is_available: d.is_available, stock: d.stock, tags: d.tags ?? [], attributes: d.attributes ?? {},
  ...(d.textScore !== undefined ? { textScore: d.textScore } : {}),
});

const col = async () => (await getDb()).collection(MENU);
export const isValidId = (id: string) => ObjectId.isValid(id) && String(new ObjectId(id)) === id;

export async function listMenu(query: MenuQuery): Promise<MenuItemWithScore[]> {
  const filter: Filter<Document> = {};
  if (query.stallId) filter.stall_id = query.stallId;
  if (query.category) filter.category = query.category;
  if (query.availableOnly) { filter.is_available = true; filter.stock = { $gt: 0 }; }
  if (query.vegOnly) filter['attributes.is_veg'] = { $ne: false }; // juices have no is_veg -> counted as veg
  if (query.q) filter.$text = { $search: query.q };

  const c = await col();
  const cursor = query.q
    ? c.find(filter, { projection: { textScore: { $meta: 'textScore' } } }).sort({ textScore: { $meta: 'textScore' } })
    : c.find(filter).sort({ category: 1, name: 1 });
  return (await cursor.limit(200).toArray()).map(toItem);
}

export async function getMenuItem(id: string): Promise<MenuItem | null> {
  if (!isValidId(id)) return null;
  const d = await (await col()).findOne({ _id: new ObjectId(id) });
  return d ? toItem(d) : null;
}

export async function getItemsByIds(ids: string[]): Promise<MenuItem[]> {
  const valid = ids.filter(isValidId).map((i) => new ObjectId(i));
  if (!valid.length) return [];
  return (await (await col()).find({ _id: { $in: valid } }).toArray()).map(toItem);
}

export async function createMenuItem(input: MenuItemInput): Promise<MenuItem> {
  const now = new Date();
  const res = await (await col()).insertOne({ ...input, created_at: now, updated_at: now });
  return toItem({ ...input, _id: res.insertedId });
}

export async function replaceMenuItem(id: string, input: MenuItemInput): Promise<MenuItem | null> {
  const d = await (await col()).findOneAndUpdate(
    { _id: new ObjectId(id) }, { $set: { ...input, updated_at: new Date() } }, { returnDocument: 'after' });
  return d ? toItem(d) : null;
}

export async function deleteMenuItem(id: string): Promise<boolean> {
  if (!isValidId(id)) return false;
  return ((await (await col()).deleteOne({ _id: new ObjectId(id) })).deletedCount ?? 0) > 0;
}

export async function setAvailability(id: string, isAvailable: boolean): Promise<MenuItem | null> {
  if (!isValidId(id)) return null;
  const d = await (await col()).findOneAndUpdate(
    { _id: new ObjectId(id) }, { $set: { is_available: isAvailable, updated_at: new Date() } }, { returnDocument: 'after' });
  return d ? toItem(d) : null;
}

/** For stall ranking: per stall, how many items can be ordered right now? (uses the aggregation pipeline) */
export async function getAvailabilityByStall(): Promise<StallAvailability[]> {
  const rows = await (await col()).aggregate([
    { $group: {
        _id: '$stall_id',
        totalItems: { $sum: 1 },
        availableItems: { $sum: { $cond: [{ $and: ['$is_available', { $gt: ['$stock', 0] }] }, 1, 0] } },
    } },
  ]).toArray();
  return rows.map((r) => ({ stallId: r._id, totalItems: r.totalItems, availableItems: r.availableItems }));
}

// ---------- stock reservation (used by the order saga) ----------
export interface StockLine { menuItemId: string; quantity: number }

/**
 * Atomically takes stock: the filter `stock >= qty` and the `$inc` happen in ONE
 * document operation, so two students can never both take the last unit.
 * If any line fails, the lines already taken are given back (all-or-nothing).
 * Returns the id of the line that failed, or null on success.
 */
export async function reserveStock(lines: StockLine[]): Promise<string | null> {
  const c = await col();
  const taken: StockLine[] = [];
  for (const l of lines) {
    const r = await c.updateOne(
      { _id: new ObjectId(l.menuItemId), is_available: true, stock: { $gte: l.quantity } },
      { $inc: { stock: -l.quantity }, $set: { updated_at: new Date() } });
    if (r.modifiedCount !== 1) {
      await releaseStock(taken);
      return l.menuItemId;
    }
    taken.push(l);
  }
  return null;
}

export async function releaseStock(lines: StockLine[]): Promise<void> {
  if (!lines.length) return;
  const c = await col();
  await Promise.all(lines.map((l) => c.updateOne({ _id: new ObjectId(l.menuItemId) }, { $inc: { stock: l.quantity } })));
}
