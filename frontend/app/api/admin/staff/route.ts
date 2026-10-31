import { z } from 'zod';
import { ApiError, json, readJson } from '@/lib/http';
import { withAuth } from '@/lib/auth/guard';
import { db, DuplicateEmailError } from '@/lib/postgres';
import { hashPassword } from '@/lib/auth/password';
import { passwordSchema } from '@/lib/auth/validation';

const body = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  stallId: z.number().int().positive(),
});

export const GET = withAuth(['admin'], async () => json({ staff: await db.listStaff() }));

export const POST = withAuth(['admin'], async (req) => {
  const b = body.parse(await readJson(req));
  if (!(await db.getStall(b.stallId))) throw new ApiError(400, 'Choose an existing stall');
  try {
    const user = await db.createUser({ name: b.name, email: b.email, passwordHash: await hashPassword(b.password), role: 'staff', stallId: b.stallId });
    return json({ staff: user }, 201);
  } catch (e) {
    if (e instanceof DuplicateEmailError) throw new ApiError(409, 'That email is already registered');
    throw e;
  }
});

export const dynamic = 'force-dynamic'; // never prerender/cache API responses
