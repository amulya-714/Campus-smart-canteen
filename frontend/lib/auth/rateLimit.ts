// Tiny in-memory limiter to slow down password guessing. (Use Redis in a multi-server deployment.)
const hits = new Map<string, number[]>();

export function tooManyAttempts(key: string, max = 8, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
export const resetAttempts = (key: string) => hits.delete(key);
