/**
 * Everything in the app imports `db` from here.
 * Use PersonOneAdapter for the real PostgreSQL implementation.
 */

import type { PgAdapter } from './types';
import { PersonOneAdapter } from './personOneAdapter';

export const db: PgAdapter = new PersonOneAdapter();

export * from './types';