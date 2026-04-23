import type { Metadata } from 'next';
import './globals.css';

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
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
