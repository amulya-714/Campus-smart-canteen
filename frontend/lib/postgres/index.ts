/**
 * >>> THE ONE SWAP POINT <<<
 * Everything in the app imports `db` from here. To use Person 1's real
 * implementation, change the single line below to their adapter class.
 */
import type { PgAdapter } from './types';
import { PlaceholderPgAdapter } from './placeholderAdapter';

export const db: PgAdapter = new PlaceholderPgAdapter();
export * from './types';
