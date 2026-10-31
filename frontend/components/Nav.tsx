'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useCart } from './CartProvider';

export default function Nav() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const path = usePathname();
  const router = useRouter();
  const on = (p: string) => (path === p || (p !== '/' && path.startsWith(p)) ? 'nav on' : 'nav');
  return (
    <header className="topbar">
      <nav className="topbar-in" aria-label="Main">
        <Link href="/" className="brand">Campus<b>Bite</b></Link>
        {user?.role === 'student' && (<>
          <Link className={on('/student/orders')} href="/student/orders">My orders</Link>
          <Link className={path === '/student' || path.startsWith('/student/stall') ? 'nav on' : 'nav'} href="/student">Stalls</Link>
          <Link className={on('/student/cart')} href="/student/cart">Cart{count > 0 ? ` (${count})` : ''}</Link>
        </>)}
        {user?.role === 'staff' && <Link className={on('/staff')} href="/staff">Stall dashboard</Link>}
        {user?.role === 'admin' && <Link className={on('/admin')} href="/admin">Admin</Link>}
        {user ? (
          <button className="btn btn-sm" onClick={async () => { await logout(); router.push('/login'); }}>Log out ({user.name.split(' ')[0]})</button>
        ) : (<>
          <Link className={on('/login')} href="/login">Log in</Link>
          <Link className={on('/register')} href="/register">Sign up</Link>
        </>)}
      </nav>
    </header>
  );
}
