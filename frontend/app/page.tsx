'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '@/components/AuthProvider';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (user) router.replace(homeFor(user.role)); }, [user, router]);
  if (loading || user) return <main className="wrap"><p className="muted">Loading…</p></main>;
  return (
    <main className="wrap">
      <section className="hero">
        <h1>Order now. Skip the queue.</h1>
        <p>Choose your food, book a 10-minute pickup window and see how busy each stall is before you walk over.</p>
        <div className="row">
          <Link className="btn btn-primary" href="/register">Create student account</Link>
          <Link className="btn" href="/login">Log in</Link>
        </div>
      </section>
    </main>
  );
}
