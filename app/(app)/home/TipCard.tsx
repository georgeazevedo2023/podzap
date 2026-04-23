/**
 * Static yellow "sacada" tip card. Text is currently fixed — when we
 * have enough data we can rotate based on tenant usage signals (very
 * few groups → "adicione mais"; low approval rate → "ajuste o tom";
 * etc.).
 */
export function TipCard(): React.ReactElement {
  return (
    <div
      className="card"
      style={{
        padding: 16,
        background: 'var(--color-yellow-500)',
        color: 'var(--color-ink-900)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        💡 sacada
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginTop: 6,
          lineHeight: 1.35,
        }}
      >
        grupos com muito áudio rendem podcasts mais longos. ative o filtro de
        relevância pra cortar os &ldquo;kkk&rdquo;.
      </div>
    </div>
  );
}

export default TipCard;
