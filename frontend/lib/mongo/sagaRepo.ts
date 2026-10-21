/**
 * The "saga log": a small MongoDB collection that remembers every order attempt.
 * It is what lets us recover if the app crashes half-way between the two databases.
 * _id = the order's requestId, so the same attempt can never be logged twice.
 */
import { getDb } from './client';
import { SAGAS } from './indexes';
import type { StockLine } from './menuRepo';

export type SagaStatus = 'PENDING' | 'COMMITTED' | 'COMPENSATED' | 'RESTOCK_PENDING' | 'CANCELLED';

export interface Saga {
  _id: string; // requestId
  student_id: number;
  stall_id: number;
  lines: StockLine[];
  status: SagaStatus;
  order_id?: number;
  reason?: string;
  created_at: Date;
  updated_at: Date;
}

export interface SagaStore {
  create(s: Omit<Saga, 'created_at' | 'updated_at' | 'status'>): Promise<void>; // throws code 11000 on duplicate
  mark(id: string, status: SagaStatus, extra?: { order_id?: number; reason?: string }): Promise<void>;
  findByStatus(statuses: SagaStatus[], olderThanMs: number): Promise<Saga[]>;
}

export const mongoSagaStore: SagaStore = {
  async create(s) {
    const now = new Date();
    await (await getDb()).collection<Saga>(SAGAS).insertOne({ ...s, status: 'PENDING', created_at: now, updated_at: now });
  },
  async mark(id, status, extra = {}) {
    await (await getDb()).collection<Saga>(SAGAS).updateOne({ _id: id }, { $set: { status, ...extra, updated_at: new Date() } });
  },
  async findByStatus(statuses, olderThanMs) {
    const cutoff = new Date(Date.now() - olderThanMs);
    return (await getDb()).collection<Saga>(SAGAS).find({ status: { $in: statuses }, updated_at: { $lt: cutoff } }).limit(200).toArray();
  },
};
