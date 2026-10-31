import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mongo/menuRepo', () => ({
  listMenu: vi.fn(), getMenuItem: vi.fn(), createMenuItem: vi.fn(), replaceMenuItem: vi.fn(),
  deleteMenuItem: vi.fn(), setAvailability: vi.fn(), getAvailabilityByStall: vi.fn(),
}));

import * as repo from '@/lib/mongo/menuRepo';
import { menuItemSchema } from '@/lib/mongo/schemas';
import { applyMenuUpdate } from '@/lib/services/menuService';
import { GET as listMenu, POST as createItem } from '@/app/api/menu/route';
import { PUT as updateItem, DELETE as deleteItem } from '@/app/api/menu/[id]/route';
import { PATCH as toggle } from '@/app/api/menu/[id]/availability/route';
import type { MenuItem } from '@/lib/types';
import { makeReq, tokenFor } from './helpers';

const m = repo as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => vi.resetAllMocks());

const base = { stall_id: 2, price: 50, stock: 10, is_available: true, description: '', tags: [] };
const juice = { ...base, name: 'Orange Juice', category: 'juice', attributes: { size: 'medium', sugar_level: 'low' } };
const sandwich = { ...base, name: 'Grilled', category: 'sandwich', attributes: { bread_type: 'brown', add_ons: ['corn'], is_spicy: false, is_veg: true } };
const snack = { ...base, name: 'Samosa', category: 'snack', attributes: { is_veg: true, portion: 'regular' } };
const combo = { ...base, name: 'Meal', category: 'combo', attributes: { combo_items: ['Sandwich', 'Juice'], is_veg: true } };

describe('menu schemas (different attributes per category)', () => {
  it('accepts a valid item of every category', () => {
    for (const d of [juice, sandwich, snack, combo]) expect(menuItemSchema.safeParse(d).success).toBe(true);
  });
  it('rejects category-specific mistakes', () => {
    const bad = [
      { ...juice, attributes: { size: 'medium' } }, // missing sugar_level
      { ...juice, attributes: { size: 'huge', sugar_level: 'low' } },
      { ...sandwich, attributes: { ...sandwich.attributes, add_ons: 'corn' } }, // must be an array
      { ...combo, attributes: { combo_items: ['Only one'], is_veg: true } }, // needs >= 2
      { ...snack, attributes: { portion: 'regular' } }, // missing is_veg
      { ...juice, category: 'pizza' },
      { ...juice, price: -5 },
      { ...juice, stock: 1.5 },
    ];
    for (const d of bad) expect(menuItemSchema.safeParse(d).success).toBe(false);
  });
});

describe('applyMenuUpdate', () => {
  const existing: MenuItem = { _id: 'a'.repeat(24), ...juice } as unknown as MenuItem;
  it('merges a partial update and re-validates', () => {
    const out = applyMenuUpdate(existing, { price: 60, attributes: { size: 'large' } });
    expect(out.price).toBe(60);
    expect(out.attributes).toEqual({ size: 'large', sugar_level: 'low' });
  });
  it('rejects invalid values and fields that must not change', () => {
    expect(() => applyMenuUpdate(existing, { stock: -1 })).toThrow();
    expect(() => applyMenuUpdate(existing, { attributes: { size: 'huge' } })).toThrow();
    expect(() => applyMenuUpdate(existing, { category: 'combo' })).toThrow(); // .strict()
    expect(() => applyMenuUpdate(existing, { stall_id: 9 })).toThrow();
  });
});

describe('menu API', () => {
  it('GET /api/menu?stallId lists a stall menu without login', async () => {
    m.listMenu.mockResolvedValue([{ _id: 'x', ...juice }]);
    const res = await listMenu(makeReq('/api/menu?stallId=2'), { params: {} });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
    expect(m.listMenu).toHaveBeenCalledWith(expect.objectContaining({ stallId: 2, availableOnly: true }));
  });
  it('GET passes search text, category and veg filter to the repo', async () => {
    m.listMenu.mockResolvedValue([]);
    await listMenu(makeReq('/api/menu?stallId=2&q=paneer&category=sandwich&veg=1&all=1'), { params: {} });
    expect(m.listMenu).toHaveBeenCalledWith({ stallId: 2, q: 'paneer', category: 'sandwich', vegOnly: true, availableOnly: false });
  });
  it('GET rejects an unknown category', async () => {
    expect((await listMenu(makeReq('/api/menu?stallId=2&category=pizza'), { params: {} })).status).toBe(400);
  });

  it('POST: 401 anonymous, 403 student', async () => {
    expect((await createItem(makeReq('/api/menu', { method: 'POST', body: juice }), { params: {} })).status).toBe(401);
    expect((await createItem(makeReq('/api/menu', { method: 'POST', body: juice, token: await tokenFor('student') }), { params: {} })).status).toBe(403);
  });
  it('POST: staff cannot add items to another stall', async () => {
    const res = await createItem(makeReq('/api/menu', { method: 'POST', body: juice, token: await tokenFor('staff', 1) }), { params: {} });
    expect(res.status).toBe(403);
    expect(m.createMenuItem).not.toHaveBeenCalled();
  });
  it('POST: staff of the stall can create; stall_id defaults to their stall', async () => {
    m.createMenuItem.mockImplementation(async (i: unknown) => ({ _id: 'n', ...(i as object) }));
    const { stall_id: _s, ...noStall } = juice;
    const res = await createItem(makeReq('/api/menu', { method: 'POST', body: noStall, token: await tokenFor('staff', 2) }), { params: {} });
    expect(res.status).toBe(201);
    expect(m.createMenuItem.mock.calls[0][0].stall_id).toBe(2);
  });
  it('POST: invalid body -> 400 with a readable message', async () => {
    const res = await createItem(makeReq('/api/menu', { method: 'POST', body: { ...juice, attributes: {} }, token: await tokenFor('admin') }), { params: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/size|sugar/);
  });

  const id = 'b'.repeat(24);
  it('PUT: staff of the same stall can edit price', async () => {
    m.getMenuItem.mockResolvedValue({ _id: id, ...juice });
    m.replaceMenuItem.mockImplementation(async (_i: string, v: unknown) => ({ _id: id, ...(v as object) }));
    const res = await updateItem(makeReq(`/api/menu/${id}`, { method: 'PUT', body: { price: 70 }, token: await tokenFor('staff', 2) }), { params: { id } });
    expect(res.status).toBe(200);
    expect(m.replaceMenuItem.mock.calls[0][1].price).toBe(70);
  });
  it('PUT/DELETE/PATCH: other stall staff are blocked, admin allowed', async () => {
    m.getMenuItem.mockResolvedValue({ _id: id, ...juice });
    m.deleteMenuItem.mockResolvedValue(true);
    m.setAvailability.mockResolvedValue({ _id: id, ...juice, is_available: false });
    const other = await tokenFor('staff', 3), admin = await tokenFor('admin');
    expect((await deleteItem(makeReq(`/api/menu/${id}`, { method: 'DELETE', token: other }), { params: { id } })).status).toBe(403);
    expect((await toggle(makeReq(`/api/menu/${id}/availability`, { method: 'PATCH', body: { is_available: false }, token: other }), { params: { id } })).status).toBe(403);
    expect((await deleteItem(makeReq(`/api/menu/${id}`, { method: 'DELETE', token: admin }), { params: { id } })).status).toBe(200);
    expect((await toggle(makeReq(`/api/menu/${id}/availability`, { method: 'PATCH', body: { is_available: false }, token: admin }), { params: { id } })).status).toBe(200);
  });
  it('DELETE on a missing item -> 404', async () => {
    m.getMenuItem.mockResolvedValue(null);
    expect((await deleteItem(makeReq(`/api/menu/${id}`, { method: 'DELETE', token: await tokenFor('admin') }), { params: { id } })).status).toBe(404);
  });
});
