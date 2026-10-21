import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { CartProvider } from '@/components/CartProvider';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'CampusBite',
  description: 'Pre-order canteen food and book a pickup slot. Skip the queue.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider><CartProvider>
          <Nav />
          {children}
        </CartProvider></AuthProvider>
      </body>
    </html>
  );
}
