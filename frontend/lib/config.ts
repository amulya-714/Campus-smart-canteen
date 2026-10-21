// Central place for reading environment variables.
export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${name}. See .env.example`);
  return v;
}

export const JWT_COOKIE = 'cb_token';
export const SESSION_DAYS = 7;
