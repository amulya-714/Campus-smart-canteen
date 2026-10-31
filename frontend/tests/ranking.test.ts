import { describe, expect, it } from 'vitest';
import { rankItems, rankStalls, scoreStall } from '@/lib/services/ranking';
import type { MenuItem } from '@/lib/types';

const avail = (stallId: number, availableItems: number, totalItems = 10) => ({ stallId, availableItems, totalItems });
const load = (stallId: number, activeOrders: number, booked = 0, cap = 90) => ({ stallId, activeOrders, capacityNextHour: cap, bookedNextHour: booked });

describe('stall score', () => {
  it('perfect stall = 100, swamped + empty shelves = 0', () => {
    expect(scoreStall(avail(1, 10), load(1, 0, 0)).score).toBe(100);
    expect(scoreStall(avail(1, 0), load(1, 40, 90)).score).toBe(0);
  });
  it('follows the documented formula', () => {
    // 0.4*0.5 + 0.4*(1-0.5) + 0.2*(1-0.5) = 0.5
    expect(scoreStall(avail(1, 5), load(1, 10, 45)).score).toBe(50);
  });
  it('labels queue length', () => {
    expect(scoreStall(avail(1, 5), load(1, 2)).label).toBe('Quiet');
    expect(scoreStall(avail(1, 5), load(1, 10)).label).toBe('Busy');
    expect(scoreStall(avail(1, 5), load(1, 18)).label).toBe('Very busy');
  });
  it('handles stalls with no data', () => {
    expect(scoreStall(undefined, undefined).score).toBe(40); // only the empty-queue term counts
  });
});

describe('rankStalls', () => {
  it('pushes the overloaded stall down even if it has more food', () => {
    const stalls = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const ranked = rankStalls(stalls, [avail(1, 10), avail(2, 8), avail(3, 3)], [load(1, 30, 80), load(2, 4, 10), load(3, 0, 0)]);
    expect(ranked.map((s) => s.id)).toEqual([2, 3, 1]);
    expect(ranked[2].label).toBe('Very busy');
  });
});

describe('rankItems', () => {
  const item = (id: string, stall_id: number, textScore?: number) => ({ _id: id, stall_id, textScore } as unknown as MenuItem & { textScore?: number });
  it('weights relevance and stall score equally', () => {
    const out = rankItems([item('a', 1, 2), item('b', 2, 1)], new Map([[1, 20], [2, 100]]));
    // a: .5*1 + .5*.2 = 60 ; b: .5*.5 + .5*1 = 75
    expect(out.map((i) => i._id)).toEqual(['b', 'a']);
    expect(out[0].rank_score).toBe(75);
  });
  it('without a search, the stall score decides', () => {
    const out = rankItems([item('a', 1), item('b', 2)], new Map([[1, 30], [2, 90]]));
    expect(out[0]._id).toBe('b');
  });
});
