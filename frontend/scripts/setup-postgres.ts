/**
 * Creates the PLACEHOLDER tables, generates pickup slots, and adds demo users.
 * Run: npm run db:setup     (create the database first:  createdb campusbite)
 * If Person 1's schema is in place, skip this and just run their setup.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../lib/postgres/client';
import { db } from '../lib/postgres';
import { hashPassword } from '../lib/auth/password';

// DEMO ONLY passwords. Change/remove before any real deployment.
const DEMO = [
  { name: 'Admin', email: 'admin@campusbite.test', password: 'Admin@123', role: 'admin' as const, stallId: null },
  { name: 'Riya (Fresh Squeeze)', email: 'staff1@campusbite.test', password: 'Staff@123', role: 'staff' as const, stallId: 1 },
  { name: 'Arun (Toasty Bites)', email: 'staff2@campusbite.test', password: 'Staff@123', role: 'staff' as const, stallId: 2 },
  { name: 'Student Demo', email: 'student@campusbite.test', password: 'Student@123', role: 'student' as const, stallId: null },
];

async function main() {
  const sql = readFileSync(join(__dirname, '..', 'db', 'placeholder_schema.sql'), 'utf8');
  await pool().query(sql);
  const n = await pool().query('SELECT placeholder_generate_slots(2) AS n');
  console.log(`Schema ready. Created ${n.rows[0].n} new pickup slots.`);
  for (const u of DEMO) {
    if (await db.findUserByEmail(u.email)) continue;
    await db.createUser({ name: u.name, email: u.email, passwordHash: await hashPassword(u.password), role: u.role, stallId: u.stallId });
    console.log(`Created demo ${u.role}: ${u.email} / ${u.password}`);
  }
  await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
