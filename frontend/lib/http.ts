import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** Turns thrown errors into clean JSON responses. */
export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) {
    const msg = e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return json({ error: msg }, 400);
  }
  console.error(e);
  return json({ error: 'Something went wrong on our side. Try again.' }, 500);
}

export async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { throw new ApiError(400, 'Request body must be valid JSON'); }
}
