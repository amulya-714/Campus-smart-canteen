/**
 * Shows that our indexes are really used, using explain('executionStats').
 * Run: npm run mongo:explain      (seed first!)
 *
 * What to look at in the output:
 *   stage            IXSCAN = index used (good).  COLLSCAN = scanned the whole collection (slow).
 *   docsExamined     how many documents Mongo had to open.
 *   keysExamined     how many index entries it read.
 */
import { getDb, closeMongo } from '../lib/mongo/client';
import { MENU } from '../lib/mongo/indexes';

function findStage(plan: any): string[] {
  if (!plan) return [];
  const out = [plan.stage];
  if (plan.inputStage) out.push(...findStage(plan.inputStage));
  if (plan.inputStages) plan.inputStages.forEach((p: any) => out.push(...findStage(p)));
  return out;
}

async function show(label: string, cursor: any) {
  const e = await cursor.explain('executionStats');
  const stats = e.executionStats;
  console.log(`\n=== ${label} ===`);
  console.log('plan stages     :', findStage(e.queryPlanner.winningPlan).join(' -> '));
  console.log('docs returned   :', stats.nReturned);
  console.log('docs examined   :', stats.totalDocsExamined);
  console.log('keys examined   :', stats.totalKeysExamined);
  console.log('time (ms)       :', stats.executionTimeMillis);
}

async function main() {
  const col = (await getDb()).collection(MENU);
  const q = { stall_id: 2, is_available: true, stock: { $gt: 0 } };

  await show('1) Menu of stall 2 WITH index (stall_avail_stock)', col.find(q));
  await show('2) Same query FORCED to scan everything ($natural hint)', col.find(q).hint({ $natural: 1 }));
  await show('3) Browse by category (category_avail index)', col.find({ category: 'juice', is_available: true }));
  await show('4) Text search "paneer" (menu_text_search index)', col.find({ $text: { $search: 'paneer' } }));
  console.log('\nTip for viva: compare docs examined in (1) vs (2). With only ~18 docs the gap is small,');
  console.log('but the index version scales with matches while the scan scales with collection size.');
  await closeMongo();
}
main().catch((e) => { console.error(e); process.exit(1); });
