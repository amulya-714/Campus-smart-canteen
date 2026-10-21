import { db } from '@/lib/postgres';
import { getAvailabilityByStall } from '@/lib/mongo/menuRepo';
import { rankStalls } from './ranking';

/** Joins PostgreSQL (stalls + live load) with MongoDB (item availability) and ranks them. */
export async function getRankedStalls() {
  const [stalls, load, avail] = await Promise.all([db.listStalls(), db.getStallLoad(), getAvailabilityByStall()]);
  return rankStalls(stalls, avail, load).map((s) => ({
    ...s, slotsFreeNextHour: Math.round(s.slotsFree * 100),
  }));
}
