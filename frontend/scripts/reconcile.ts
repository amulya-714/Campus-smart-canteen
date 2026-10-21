/** Finishes or undoes half-done orders. Run by hand or from cron every few minutes: npm run reconcile */
import { reconcile } from '../lib/services/orderSaga';
import { sagaDeps } from '../lib/services/defaultDeps';
import { closeMongo } from '../lib/mongo/client';
import { pool } from '../lib/postgres/client';

reconcile(sagaDeps)
  .then(async (r) => { console.log('Reconcile result:', r); await closeMongo(); await pool().end(); })
  .catch((e) => { console.error(e); process.exit(1); });
