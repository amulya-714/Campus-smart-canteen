'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { Err } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';

export default function Register() {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const router = useRouter(); const { refresh } = useAuth();

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/api/auth/register', { method: 'POST', body: { name, email, password } }); await refresh(); router.push('/student'); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <main className="wrap">
      <form className="form-card" onSubmit={submit}>
        <h1>Create account</h1>
        <label className="field">Full name<input className="input" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">College email<input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password
          <input className="input" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="hint">At least 8 characters, with a letter and a number.</span>
        </label>
        <Err msg={err} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="muted" style={{ marginTop: '1rem' }}>Already registered? <Link href="/login">Log in</Link></p>
      </form>
    </main>
  );
}
