import { z } from 'zod';

export const passwordSchema = z.string().min(8, 'at least 8 characters').max(72)
  .regex(/[A-Za-z]/, 'must contain a letter').regex(/\d/, 'must contain a digit');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  password: passwordSchema,
}).strict(); // .strict(): a "role" field in the body is REJECTED, so nobody can self-register as admin

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});
