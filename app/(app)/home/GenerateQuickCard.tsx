import Link from 'next/link';

import { Icons } from '@/components/icons/Icons';
import { MicMascot } from '@/components/ui/MicMascot';

/**
 * "bora" quick-action card — sprinkle background + party-mascot mic.
 *
 * TODO(fase-13): open an inline modal to choose group + time range +
 * tone and POST to a new `/api/summaries/generate` endpoint. For the
 * MVP we just link to `/schedule` so the user can configure the run.
 */
export function GenerateQuickCard(): React.ReactElement {
  return (
    <div
      className="card sprinkle"
      style={{ padding: 18, position: 'relative', overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', top: -8, right: -8 }}>
        <MicMascot size={72} mood="party" />
      </div>
      <span className="sticker sticker-pink" style={{ marginBottom: 10 }}>
        ✨ bora
      </span>
      <h3
        style={{
          margin: '0 0 6px',
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          maxWidth: 160,
        }}
      >
        gerar resumo agora
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: 'var(--color-text-dim)',
        }}
      >
        pega as últimas 24h do grupo e vira um pod de 5 min
      </p>
      <Link
        href="/schedule"
        className="btn btn-purple"
        style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}
      >
        <Icons.Sparkle /> fazer podcast
      </Link>
    </div>
  );
}

export default GenerateQuickCard;
