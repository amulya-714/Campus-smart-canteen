/**
 * DEMAND-AWARE RANKING  (pure functions: easy to read and test)
 *
 * Stall score (0-100) = 100 x ( 0.4 x Availability + 0.4 x (1 - Load) + 0.2 x SlotsFree )
 *
 *   Availability = items you can order right now / total items       (0 to 1)
 *   Load         = active orders (placed + preparing) / 20, capped at 1   (0 = empty queue, 1 = swamped)
 *   SlotsFree    = 1 - (booked / capacity) over the next hour's pickup slots (0 to 1)
 *
 * So a stall with lots of food in stock, a short queue and open pickup slots ranks high;
 * an overloaded stall ranks low and students get nudged elsewhere.
 *
 * Item ranking (search results):
 *   item score = 100 x ( 0.5 x Relevance + 0.5 x StallScore/100 )
 *   Relevance = how well the text matches the search (1 if there is no search text).
 */
import type { MenuItem, StallAvailability, StallLoad } from '@/lib/types';

export const W = { availability: 0.4, load: 0.4, slots: 0.2 };
export const QUEUE_CAPACITY = 20; // orders a stall can comfortably have "in flight"

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export interface StallScore {
  stallId: number; score: number; availability: number; load: number; slotsFree: number;
  label: 'Quiet' | 'Busy' | 'Very busy';
}

export function scoreStall(avail: StallAvailability | undefined, load: StallLoad | undefined): StallScore {
  const availability = avail && avail.totalItems > 0 ? avail.availableItems / avail.totalItems : 0;
  const loadRatio = clamp01((load?.activeOrders ?? 0) / QUEUE_CAPACITY);
  const slotsFree = load && load.capacityNextHour > 0 ? clamp01(1 - load.bookedNextHour / load.capacityNextHour) : 0;
  const score = 100 * (W.availability * availability + W.load * (1 - loadRatio) + W.slots * slotsFree);
  return {
    stallId: avail?.stallId ?? load?.stallId ?? 0,
    score: Math.round(score * 10) / 10,
    availability: Math.round(availability * 100) / 100,
    load: Math.round(loadRatio * 100) / 100,
    slotsFree: Math.round(slotsFree * 100) / 100,
    label: loadRatio < 0.4 ? 'Quiet' : loadRatio < 0.75 ? 'Busy' : 'Very busy',
  };
}

export function rankStalls<T extends { id: number }>(
  stalls: T[], avail: StallAvailability[], load: StallLoad[],
): (T & StallScore & { availableItems: number; totalItems: number; activeOrders: number })[] {
  return stalls
    .map((s) => {
      const a = avail.find((x) => x.stallId === s.id);
      const l = load.find((x) => x.stallId === s.id);
      return { ...s, ...scoreStall(a, l), stallId: s.id, availableItems: a?.availableItems ?? 0, totalItems: a?.totalItems ?? 0, activeOrders: l?.activeOrders ?? 0 };
    })
    .sort((x, y) => y.score - x.score);
}

export function rankItems(
  items: (MenuItem & { textScore?: number })[], stallScores: Map<number, number>,
): (MenuItem & { rank_score: number })[] {
  const maxText = Math.max(0, ...items.map((i) => i.textScore ?? 0));
  return items
    .map((i) => {
      const relevance = maxText > 0 ? (i.textScore ?? 0) / maxText : 1;
      const stall = (stallScores.get(i.stall_id) ?? 0) / 100;
      const { textScore: _t, ...clean } = i;
      return { ...clean, rank_score: Math.round(100 * (0.5 * relevance + 0.5 * stall) * 10) / 10 };
    })
    .sort((a, b) => b.rank_score - a.rank_score);
}
