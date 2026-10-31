/**
 * Seeds MongoDB with realistic menu items for 4 stalls.
 * Stall ids 1-4 match db/schema.sql.   Run: npm run mongo:seed
 */
import { getDb, closeMongo } from '../lib/mongo/client';
import { ensureMongoSetup, MENU } from '../lib/mongo/indexes';
import { menuItemSchema, type MenuItemInput } from '../lib/mongo/schemas';

const j = (stall_id: number, name: string, price: number, stock: number, size: 'small' | 'medium' | 'large', sugar_level: 'none' | 'low' | 'regular' | 'high', tags: string[] = []): MenuItemInput =>
  ({ stall_id, name, category: 'juice', description: `Fresh ${name.toLowerCase()}`, price, stock, is_available: true, tags: ['juice', 'cold', ...tags], attributes: { size, sugar_level } });
const s = (stall_id: number, name: string, price: number, stock: number, bread_type: 'white' | 'brown' | 'multigrain' | 'focaccia', add_ons: string[], is_spicy: boolean, is_veg: boolean): MenuItemInput =>
  ({ stall_id, name, category: 'sandwich', description: `${name} on ${bread_type} bread`, price, stock, is_available: true, tags: ['sandwich', is_veg ? 'veg' : 'non-veg'], attributes: { bread_type, add_ons, is_spicy, is_veg } });
const n = (stall_id: number, name: string, price: number, stock: number, is_veg: boolean, portion: 'small' | 'regular' | 'large' = 'regular'): MenuItemInput =>
  ({ stall_id, name, category: 'snack', description: name, price, stock, is_available: true, tags: ['snack', is_veg ? 'veg' : 'non-veg'], attributes: { is_veg, portion } });
const c = (stall_id: number, name: string, price: number, stock: number, combo_items: string[], is_veg: boolean): MenuItemInput =>
  ({ stall_id, name, category: 'combo', description: `Includes ${combo_items.join(', ')}`, price, stock, is_available: true, tags: ['combo', 'value'], attributes: { combo_items, is_veg } });

const items: MenuItemInput[] = [
  // Stall 1: Fresh Squeeze (juices)
  j(1, 'Orange Juice', 40, 60, 'medium', 'low'),
  j(1, 'Watermelon Juice', 35, 50, 'large', 'none', ['summer']),
  j(1, 'Sugarcane Juice', 30, 40, 'medium', 'regular'),
  j(1, 'Mixed Fruit Juice', 50, 30, 'large', 'regular'),
  j(1, 'Mosambi Juice', 40, 0, 'medium', 'low'), // out of stock on purpose (demo)
  // Stall 2: Toasty Bites (sandwiches)
  s(2, 'Veg Grilled Sandwich', 60, 40, 'brown', ['extra cheese', 'corn'], false, true),
  s(2, 'Paneer Tikka Sandwich', 80, 30, 'multigrain', ['mint chutney'], true, true),
  s(2, 'Chicken Club Sandwich', 110, 25, 'white', ['egg', 'extra cheese'], true, false),
  s(2, 'Cheese Chilli Toast', 55, 35, 'white', ['green chilli'], true, true),
  // Stall 3: Spice Route Snacks
  n(3, 'Samosa (2 pcs)', 25, 80, true),
  n(3, 'Vada Pav', 20, 70, true),
  n(3, 'Chicken Puff', 35, 30, false),
  n(3, 'French Fries', 50, 45, true, 'large'),
  n(3, 'Masala Maggi', 45, 50, true),
  // Stall 4: Meal Deal Counter (combos)
  c(4, 'Sandwich + Juice Combo', 99, 30, ['Veg Grilled Sandwich', 'Orange Juice'], true),
  c(4, 'Samosa + Chai Combo', 40, 60, ['Samosa', 'Masala Chai'], true),
  c(4, 'Burger + Fries + Coke', 140, 20, ['Veg Burger', 'French Fries', 'Coke'], true),
  c(4, 'Chicken Roll Meal', 150, 15, ['Chicken Roll', 'Fries', 'Lime Soda'], false),
];

async function main() {
  const db = await getDb();
  await ensureMongoSetup(db);
  const col = db.collection(MENU);
  await col.deleteMany({}); // seed is for dev data only
  const now = new Date();
  const docs = items.map((i) => ({ ...menuItemSchema.parse(i), created_at: now, updated_at: now }));
  const res = await col.insertMany(docs);
  console.log(`Seeded ${res.insertedCount} menu items across 4 stalls.`);
  await closeMongo();
}
main().catch((e) => { console.error(e); process.exit(1); });
