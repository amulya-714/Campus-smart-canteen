import { json } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { db } from '@/lib/postgres';
import { getForecast } from '@/lib/services/forecast';

// One call that feeds the admin dashboard: slot utilization + recent daily orders + tomorrow's forecast.
export const GET = withAuth(['admin'], async () => {
  const [slots, daily, forecast] = await Promise.all([db.getSlotUtilization(), db.getDailyOrderCounts(14), getForecast()]);

  const byHour = new Map<number, { capacity: number; booked: number }>();
  const byStall = new Map<number, { capacity: number; booked: number }>();
  for (const s of slots) {
    const h = new Date(s.start).getHours();
    const a = byHour.get(h) ?? { capacity: 0, booked: 0 };
    byHour.set(h, { capacity: a.capacity + s.capacity, booked: a.booked + s.booked });
    const b = byStall.get(s.stallId) ?? { capacity: 0, booked: 0 };
    byStall.set(s.stallId, { capacity: b.capacity + s.capacity, booked: b.booked + s.booked });
  }
  return json({
    utilizationByHour: [...byHour].sort((x, y) => x[0] - y[0]).map(([hour, v]) => ({ hour, ...v })),
    utilizationByStall: [...byStall].map(([stallId, v]) => ({ stallId, ...v })),
    dailyOrders: daily,
    forecast,
  });
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
