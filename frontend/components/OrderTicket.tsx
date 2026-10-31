'use client';
import type { ReactNode } from 'react';
import { rupees, timeOf } from '@/lib/client/format';
import type { Order } from '@/lib/types';

/** An order shown as a pickup token: the big number is what you say at the counter. */
export default function OrderTicket({ order, actions, showStudent }: { order: Order; actions?: ReactNode; showStudent?: boolean }) {
  return (
    <article className="ticket" aria-label={`Order ${order.id}`}>
      <div className="ticket-top">
        <div><div className="muted">Token</div><div className="token">#{order.id}</div></div>
        <div style={{ textAlign: 'right' }}>
          <span className={`chip ${order.status}`}>{order.status[0] + order.status.slice(1).toLowerCase()}</span>
          <div className="muted" style={{ marginTop: '.4rem' }}>Pickup {timeOf(order.slotStart)}</div>
        </div>
      </div>
      <div className="ticket-body">
        {order.stallName && <strong>{order.stallName}</strong>}
        {showStudent && order.studentName && <span className="muted">for {order.studentName}</span>}
        <ul>{order.items.map((i) => <li key={i.menuItemId}>{i.quantity} × {i.name}</li>)}</ul>
        <div className="row between"><span className="muted">{new Date(order.createdAt).toLocaleDateString()}</span><strong>{rupees(order.totalAmount)}</strong></div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </article>
  );
}
