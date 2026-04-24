'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { MicMascot } from '@/components/ui/MicMascot';
import { Sticker } from '@/components/ui/Sticker';

/**
 * Banner "IA cozinhando o resumo" exibido no topo de `/approval` enquanto
 * uma geração disparada pelo `GenerateNowModal` ainda não materializou a
 * row `pending_review` no banco.
 *
 * Como funciona:
 *   1. O modal grava `localStorage.podzap_generating` com metadata da
 *      geração: `{ requestId, groupId, groupName, tone, startedAt }`.
 *   2. Este banner (client) lê o storage no mount, inicia um countdown
 *      visual (~30s) + polling em `/api/summaries?status=pending_review`
 *      a cada 3s.
 *   3. Quando o poll encontrar um summary cujo `createdAt >= startedAt`
 *      (com tolerância de clock skew) e `groupId` bate, considera que
 *      chegou: dispara um `router.refresh()` e limpa o storage.
 *   4. Timeout hard em 60s — se não vier nada, troca o texto pra
 *      "parece que deu ruim — dá F5" e expõe um botão "fechar".
 *
 * Sem Supabase realtime de propósito: menos magia, funciona cross-tab e
 * sobrevive a navegações soft (o storage é o estado).
 */

export const STORAGE_KEY = 'podzap_generating';

export interface GeneratingTicket {
  requestId: string;
  groupId: string;
  groupName: string;
  tone: 'formal' | 'fun' | 'corporate';
  /** ISO timestamp do momento em que o POST /api/summaries/generate foi despachado. */
  startedAt: string;
}

const POLL_INTERVAL_MS = 3_000;
const COUNTDOWN_TOTAL_S = 30;
const HARD_TIMEOUT_MS = 60_000;
/** Tolerância p/ clock skew entre cliente e servidor ao bater `createdAt`. */
const SKEW_TOLERANCE_MS = 5_000;

type Phase = 'cooking' | 'arrived' | 'timeout';

interface SummaryPollRow {
  id: string;
  groupId: string;
  status: string;
  createdAt: string;
}

function readTicket(): GeneratingTicket | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GeneratingTicket>;
    if (
      !parsed ||
      typeof parsed.requestId !== 'string' ||
      typeof parsed.groupId !== 'string' ||
      typeof parsed.groupName !== 'string' ||
      typeof parsed.tone !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }
    return parsed as GeneratingTicket;
  } catch {
    return null;
  }
}

function clearTicket() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort; private mode etc.
  }
}

function buildCountdownCopy(remainingS: number, phase: Phase): string {
  if (phase === 'timeout')
    return 'parece que deu ruim — dá F5 ou tenta de novo 😬';
  if (phase === 'arrived') return 'chegou! 🎉';
  if (remainingS <= 0) return 'quase lá 🤞';
  if (remainingS <= 5) return `tá quase… ${remainingS}s`;
  return `~${remainingS}s restando`;
}

export function GeneratingBanner() {
  const router = useRouter();
  const [ticket, setTicket] = useState<GeneratingTicket | null>(null);
  const [phase, setPhase] = useState<Phase>('cooking');
  const [tick, setTick] = useState(0); // força re-render pro countdown
  const dismissedRef = useRef(false);

  // Mount: lê o ticket do localStorage + escuta mudanças cross-tab.
  useEffect(() => {
    setTicket(readTicket());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setTicket(readTicket());
      setPhase('cooking');
      dismissedRef.current = false;
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Tick de 1s pro countdown visual.
  useEffect(() => {
    if (!ticket || phase !== 'cooking') return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000);
    return () => window.clearInterval(id);
  }, [ticket, phase]);

  // Timeout hard em 60s.
  useEffect(() => {
    if (!ticket || phase !== 'cooking') return;
    const elapsed = Date.now() - new Date(ticket.startedAt).getTime();
    const remaining = HARD_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      setPhase('timeout');
      return;
    }
    const id = window.setTimeout(() => setPhase('timeout'), remaining);
    return () => window.clearTimeout(id);
  }, [ticket, phase]);

  // Polling em /api/summaries procurando a row recém-gerada.
  const pollOnce = useCallback(async (active: GeneratingTicket) => {
    try {
      const res = await fetch(
        `/api/summaries?status=pending_review&limit=20`,
        { cache: 'no-store' },
      );
      if (!res.ok) return false;
      const body = (await res.json()) as { summaries?: SummaryPollRow[] };
      const list = body.summaries ?? [];
      const startedAtMs = new Date(active.startedAt).getTime();
      const matched = list.find(
        (s) =>
          s.groupId === active.groupId &&
          new Date(s.createdAt).getTime() >= startedAtMs - SKEW_TOLERANCE_MS,
      );
      return Boolean(matched);
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!ticket || phase !== 'cooking') return;
    let cancelled = false;

    const loop = async () => {
      if (cancelled || dismissedRef.current) return;
      const arrived = await pollOnce(ticket);
      if (cancelled) return;
      if (arrived) {
        dismissedRef.current = true;
        setPhase('arrived');
        clearTicket();
        // Puxa os dados server-side pra lista atualizar sem F5.
        router.refresh();
      }
    };

    // Primeiro poll quase-imediato pra pegar casos em que a row já chegou
    // antes do banner montar (refresh tardio, redirect demorado, etc.).
    const firstId = window.setTimeout(loop, 400);
    const intervalId = window.setInterval(loop, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(firstId);
      window.clearInterval(intervalId);
    };
  }, [ticket, phase, pollOnce, router]);

  // Auto-dissolve 2.5s depois de "arrived".
  useEffect(() => {
    if (phase !== 'arrived') return;
    const id = window.setTimeout(() => setTicket(null), 2_500);
    return () => window.clearTimeout(id);
  }, [phase]);

  if (!ticket) return null;

  const elapsedS = Math.max(
    0,
    Math.floor((Date.now() - new Date(ticket.startedAt).getTime()) / 1_000),
  );
  const remainingS = Math.max(0, COUNTDOWN_TOTAL_S - elapsedS);
  const progressPct = Math.min(
    100,
    Math.round((elapsedS / COUNTDOWN_TOTAL_S) * 100),
  );
  // Mantém tick ativo pra o linter não reclamar (força re-render a cada segundo)
  void tick;

  const copy = buildCountdownCopy(remainingS, phase);
  const toneLabel =
    ticket.tone === 'fun'
      ? 'divertido'
      : ticket.tone === 'formal'
        ? 'formal'
        : 'corporativo';
  const toneEmoji =
    ticket.tone === 'fun' ? '🎉' : ticket.tone === 'formal' ? '🎩' : '💼';

  const isDone = phase === 'arrived';
  const isDead = phase === 'timeout';

  const accentBg = isDone
    ? 'var(--lime-500)'
    : isDead
      ? 'var(--pink-500)'
      : 'var(--purple-600)';
  const accentFg = isDone || isDead ? '#fff' : '#fff';

  const handleDismiss = () => {
    clearTicket();
    setTicket(null);
  };

  return (
    <div
      className="card"
      role="status"
      aria-live="polite"
      style={{
        padding: 20,
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gap: 20,
        alignItems: 'center',
        background: 'var(--bg-2)',
        borderWidth: '2.5px',
        animation: isDone ? 'podzapBannerOut 2.4s ease forwards' : undefined,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Progress bar no fundo — "enchendo" até 100% enquanto cozinha. */}
      {!isDead && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            height: 6,
            width: `${isDone ? 100 : progressPct}%`,
            background: accentBg,
            transition: 'width 1s linear',
          }}
        />
      )}

      <div
        style={{
          animation: isDead ? 'none' : 'wiggle 2.8s ease-in-out infinite',
        }}
      >
        <MicMascot size={72} mood={isDone ? 'party' : 'thinking'} bounce={!isDead} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Sticker variant="purple">
            {isDone ? '✅ pronto' : isDead ? '⚠️ atrasou' : '🔥 cozinhando'}
          </Sticker>
          <Sticker variant="yellow">
            {toneEmoji} {toneLabel}
          </Sticker>
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          {isDone
            ? `resumo de ${ticket.groupName} chegou! 🎉`
            : isDead
              ? `travou gerando ${ticket.groupName}`
              : `IA cozinhando o resumo de ${ticket.groupName}`}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-dim)',
            animation:
              !isDone && !isDead
                ? 'podzapPulse 1.4s ease-in-out infinite'
                : undefined,
          }}
        >
          {copy}
        </div>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        className="btn btn-ghost"
        aria-label="fechar aviso"
        style={{
          padding: '8px 14px',
          fontSize: 13,
        }}
      >
        {isDone ? 'beleza ✨' : isDead ? 'fechar' : 'ok, to esperando'}
      </button>

      <style>{`
        @keyframes podzapPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        @keyframes podzapBannerOut {
          0%, 70% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-8px); }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
      `}</style>
    </div>
  );
}

export default GeneratingBanner;
