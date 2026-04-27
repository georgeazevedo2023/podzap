import type { Metadata, Viewport } from 'next';
import {
  Archivo_Black,
  Bricolage_Grotesque,
  JetBrains_Mono,
  Space_Grotesk,
} from 'next/font/google';

import './globals.css';

/**
 * Fontes carregadas via `next/font/google` — self-hosted no build,
 * imunes a bloqueio de CDN do Google / CSP do gateway. Ligamos cada
 * uma a uma CSS var (--font-*) que `app/globals.css` já consome.
 *
 * Sem isso, o `@import` do Google Fonts em globals.css não resolve em
 * prod (o fonts.googleapis.com response cai em fallback system-ui) e
 * a logo renderiza totalmente diferente do protótipo (user reportou).
 */
const archivoBlack = Archivo_Black({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-brand-archivo',
  display: 'swap',
});

const bricolageGrotesque = Bricolage_Grotesque({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-display-bricolage',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-body-space',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-mono-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'podZAP — zap → podcast',
  description:
    'Transforme caos de mensagens em um podcast inteligente — com controle humano antes da publicação.',
  manifest: '/manifest.webmanifest',
  applicationName: 'podZAP',
  appleWebApp: {
    capable: true,
    title: 'podZAP',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
};

// Mobile-first viewport: device-width prevents the desktop-style scaling that
// was happening (no <meta viewport> at all) and viewport-fit=cover lets us
// honor iOS safe-area insets in the bottom nav. theme-color matches the dark
// app shell so the iOS status bar blends in.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFBF2' },
    { media: '(prefers-color-scheme: dark)', color: '#08030F' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const fontVars = [
    archivoBlack.variable,
    bricolageGrotesque.variable,
    spaceGrotesk.variable,
    jetbrainsMono.variable,
  ].join(' ');
  return (
    <html lang="pt-BR" className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
