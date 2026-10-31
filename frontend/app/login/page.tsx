'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { Err } from '@/components/ui';
import { homeFor, useAuth, type Me } from '@/components/AuthProvider';

export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const router = useRouter(); const { refresh } = useAuth();

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const { user } = await api<{ user: Me }>('/api/auth/login', { method: 'POST', body: { email, password } });
      await refresh(); router.push(homeFor(user.role));
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <main className="wrap">
      <form className="form-card" onSubmit={submit}>
        <h1>Log in</h1>
        <label className="field">Email<input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password<input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <Err msg={err} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="muted" style={{ marginTop: '1rem' }}>New here? <Link href="/register">Create a student account</Link></p>
      </form>
    </main>
  );
}
