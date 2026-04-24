import type { Metadata } from 'next';
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
