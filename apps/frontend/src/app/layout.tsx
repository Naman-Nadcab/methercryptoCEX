import type { Metadata, Viewport } from 'next';
import { Inter, Orbitron, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { DockerUserAppHint } from '@/components/DockerUserAppHint';
import { Toaster } from '@/components/ui/toaster';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0e11',
};

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-orbitron',
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'CryptoExchange - Trade Crypto with Confidence',
  description: 'Secure and fast cryptocurrency exchange for spot trading and P2P transactions',
  keywords: ['crypto', 'exchange', 'bitcoin', 'ethereum', 'trading'],
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${orbitron.variable} ${ibmPlexMono.variable} font-sans antialiased`}>
        <Providers>
          <DockerUserAppHint />
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
