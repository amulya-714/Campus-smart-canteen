import type { Db } from 'mongodb';
import { menuJsonSchema } from './schemas';

export const MENU = 'menu_items';
export const SAGAS = 'order_sagas';

/**
 * Creates collections (with validator) and indexes. Safe to run many times.
 *
 * Why each index exists:
 *  - {stall_id, is_available, stock}: the MOST common query -> "what can I order at stall X right now?"
 *  - {category, is_available}: browse by category across stalls.
 *  - text index on name/description/tags: powers the search box ($text).
 *  - sagas {status, updated_at}: reconciler finds stuck sagas quickly.
 */
export async function ensureMongoSetup(db: Db) {
  const existing = (await db.listCollections({ name: MENU }).toArray()).length > 0;
  const options = { validator: { $jsonSchema: menuJsonSchema }, validationLevel: 'strict' as const, validationAction: 'error' as const };
  if (existing) await db.command({ collMod: MENU, ...options });
  else await db.createCollection(MENU, options);

  const menu = db.collection(MENU);
  await menu.createIndex({ stall_id: 1, is_available: 1, stock: 1 }, { name: 'stall_avail_stock' });
  await menu.createIndex({ category: 1, is_available: 1 }, { name: 'category_avail' });
  await menu.createIndex({ name: 'text', description: 'text', tags: 'text' }, { name: 'menu_text_search' });

  const sagas = db.collection(SAGAS);
  await sagas.createIndex({ status: 1, updated_at: 1 }, { name: 'saga_status_updated' });
}
