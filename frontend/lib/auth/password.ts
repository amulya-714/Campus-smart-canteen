import bcrypt from 'bcryptjs';

// bcrypt = slow, salted hash. The "12" is the cost: each +1 doubles the work,
// which makes brute-forcing a stolen hash table very expensive.
const COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
