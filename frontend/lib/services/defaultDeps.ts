import { db } from '@/lib/postgres';
import { getItemsByIds, reserveStock, releaseStock } from '@/lib/mongo/menuRepo';
import { mongoSagaStore } from '@/lib/mongo/sagaRepo';
import type { SagaDeps } from './orderSaga';

// The real wiring. Tests pass fakes instead.
export const sagaDeps: SagaDeps = {
  db,
  menu: { getItemsByIds, reserveStock, releaseStock },
  sagas: mongoSagaStore,
};
