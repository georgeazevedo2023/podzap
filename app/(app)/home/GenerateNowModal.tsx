'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Icons } from '@/components/icons/Icons';
import { Modal } from '@/components/ui/Modal';
import { RadioPill } from '@/components/ui/RadioPill';
import { Select } from '@/components/ui/Select';

type Tone = 'formal' | 'fun' | 'corporate';
type Period = '24h' | '7d';
type VoiceMode = 'single' | 'duo';

interface GroupOption {
  id: string;
  name: string;
}

/**
 * Chave do ticket de "gerando resumo" gravado em localStorage logo após o
 * POST /api/summaries/generate retornar 202. O banner em /approval
 * (`GeneratingBanner.tsx`) lê esse ticket pra mostrar o countdown e some
 * sozinho quando a row pending_review chega. Mantém em sincronia com
 * `STORAGE_KEY` de `app/(app)/approval/GeneratingBanner.tsx`.
 */
const GENERATING_STORAGE_KEY = 'podzap_generating';

interface GeneratingTicket {
  requestId: string;
  groupId: string;
  groupName: string;
  tone: Tone;
  startedAt: string;
}

/**
 * Lê o ticket atual do localStorage. Retorna `null` se não tiver, tiver
 * expirado (> 60s), ou vier corrompido. 60s casa com o timeout hard do
 * banner — depois disso faz mais sentido deixar o usuário tentar de novo
 * do que travar o botão pra sempre.
 */
function readActiveTicket(): GeneratingTicket | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(GENERATING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GeneratingTicket>;
    if (
      !parsed.requestId ||
      !parsed.groupId ||
      !parsed.groupName ||
      !parsed.tone ||
      !parsed.startedAt
    ) {
      return null;
    }
    const age = Date.now() - new Date(parsed.startedAt).getTime();
    if (!Number.isFinite(age) || age > 60_000) {
      window.localStorage.removeItem(GENERATING_STORAGE_KEY);
      return null;
    }
    return parsed as GeneratingTicket;
  } catch {
    return null;
  }
}

interface GenerateNowModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Optional group id to pre-select when the modal opens. Used by the history
   * page filter so "gerar resumo agora" inherits the group currently being
   * viewed. Ignored if the id isn't in the monitored list (falls back to the
   * first group).
   */
  initialGroupId?: string;
}

const TONE_OPTIONS: { value: Tone; label: string; emoji: string }[] = [
  { value: 'fun', label: 'divertido', emoji: '🎉' },
  { value: 'formal', label: 'formal', emoji: '🎩' },
  { value: 'corporate', label: 'corporativo', emoji: '💼' },
];

const VOICE_MODE_OPTIONS: { value: VoiceMode; label: string; emoji: string }[] = [
  { value: 'duo', label: 'dupla (1M+1F)', emoji: '🎙️🎙️' },
  { value: 'single', label: 'solo', emoji: '🎙️' },
];

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '24h', label: 'últimas 24h' },
  { value: '7d', label: 'últimos 7 dias' },
];

export function GenerateNowModal({
  open,
  onClose,
  initialGroupId,
}: GenerateNowModalProps) {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupId, setGroupId] = useState('');
  const [tone, setTone] = useState<Tone>('fun');
  const [period, setPeriod] = useState<Period>('24h');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('duo');
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Ticket ativo de geração — se já tem um, a gente bloqueia novo submit
   * pra evitar duplicata enquanto o banner em /approval ainda está
   * cozinhando. Recalculado toda vez que o modal abre.
   */
  const [activeTicket, setActiveTicket] = useState<GeneratingTicket | null>(
    null,
  );

  // Reset + load monitored groups on open.
  useEffect(() => {
    if (!open) return;

    setError(null);
    setSubmitting(false);
    setFetching(true);
    setActiveTicket(readActiveTicket());

    let cancelled = false;
    fetch('/api/groups?monitoredOnly=true&pageSize=100', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('falha ao carregar grupos');
        const data = (await res.json()) as {
          groups?: { id: string; name: string | null }[];
        };
        if (cancelled) return;
        const list: GroupOption[] = (data.groups ?? []).map((g) => ({
          id: g.id,
          name: g.name?.trim() || '(sem nome)',
        }));
        setGroups(list);
        setGroupId((prev) => {
          // Priority: caller's `initialGroupId` (e.g. the history filter)
          // > previous selection > first group.
          if (initialGroupId && list.some((g) => g.id === initialGroupId)) {
            return initialGroupId;
          }
          if (prev && list.some((g) => g.id === prev)) return prev;
          return list[0]?.id ?? '';
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'falha ao carregar grupos');
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, initialGroupId]);

  const handleSubmit = async () => {
    if (!groupId) {
      setError('selecione um grupo');
      return;
    }
    // Guarda-chuva anti-duplicata: se já tem ticket em voo, redireciona
    // em vez de disparar outra geração.
    if (readActiveTicket()) {
      onClose();
      router.push('/approval');
      router.refresh();
      return;
    }
    setSubmitting(true);
    setError(null);

    const now = new Date();
    const hours = period === '24h' ? 24 : 24 * 7;
    const periodEnd = now.toISOString();
    const periodStart = new Date(now.getTime() - hours * 3_600_000).toISOString();

    try {
      const res = await fetch('/api/summaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, periodStart, periodEnd, tone, voiceMode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }

      // Grava o ticket pro GeneratingBanner pegar ao renderizar /approval.
      // O `requestId` é só um nonce — o banner bate por `groupId` +
      // `startedAt` pra descobrir que a row chegou.
      const groupName =
        groups.find((g) => g.id === groupId)?.name ?? 'grupo';
      const ticket: GeneratingTicket = {
        requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        groupId,
        groupName,
        tone,
        startedAt: now.toISOString(),
      };
      try {
        window.localStorage.setItem(
          GENERATING_STORAGE_KEY,
          JSON.stringify(ticket),
        );
      } catch {
        // storage indisponível (private mode, cota cheia) — o fluxo segue,
        // só não mostra o banner.
      }

      onClose();
      router.push('/approval');
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'falha ao gerar resumo');
      setSubmitting(false);
    }
  };

  const hasGroups = groups.length > 0;
  const hasActiveTicket = activeTicket !== null;
  const canSubmit =
    hasGroups && !!groupId && !submitting && !fetching && !hasActiveTicket;

  const errorBoxStyle: CSSProperties = {
    background: 'rgba(255, 77, 60, 0.12)',
    border: '1.5px solid #FF4D3C',
    borderRadius: 12,
    padding: '10px 12px',
    color: '#FF4D3C',
    fontSize: 13,
    fontWeight: 600,
  };

  const mutedStyle: CSSProperties = {
    color: 'var(--text-dim)',
    fontSize: 14,
    margin: 0,
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="gerar resumo agora"
      size="md"
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={submitting}
            style={submitting ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            cancelar
          </button>
          <button
            type="button"
            className="btn btn-purple"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={!canSubmit ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {submitting ? (
              'gerando…'
            ) : hasActiveTicket ? (
              <>
                <Icons.Sparkle /> já tem um cozinhando
              </>
            ) : (
              <>
                <Icons.Sparkle /> fazer podcast
              </>
            )}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {fetching ? (
          <p style={mutedStyle}>carregando grupos…</p>
        ) : !hasGroups ? (
          <p style={mutedStyle}>
            nenhum grupo monitorado. marque pelo menos um em{' '}
            <a href="/groups" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
              /groups
            </a>
            .
          </p>
        ) : (
          <Select
            label="grupo"
            id="gen-group"
            value={groupId}
            onChange={setGroupId}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            disabled={submitting}
          />
        )}

        <RadioPill<Tone>
          label="tom"
          name="gen-tone"
          value={tone}
          onChange={setTone}
          options={TONE_OPTIONS}
        />

        <RadioPill<Period>
          label="período"
          name="gen-period"
          value={period}
          onChange={setPeriod}
          options={PERIOD_OPTIONS}
        />

        <RadioPill<VoiceMode>
          label="formato do áudio"
          name="gen-voice-mode"
          value={voiceMode}
          onChange={setVoiceMode}
          options={VOICE_MODE_OPTIONS}
        />

        {error ? <div style={errorBoxStyle}>{error}</div> : null}

        {hasActiveTicket ? (
          <div
            style={{
              background: 'rgba(124, 92, 255, 0.12)',
              border: '1.5px solid var(--purple-600)',
              borderRadius: 12,
              padding: '10px 12px',
              color: 'var(--text)',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span aria-hidden>🔥</span>
            <span>
              a IA ainda tá cozinhando o resumo de{' '}
              <strong>{activeTicket?.groupName}</strong> — espera ele aparecer
              em <a href="/approval" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>/aprovações</a>{' '}
              antes de pedir outro.
            </span>
          </div>
        ) : null}

        <p style={{ ...mutedStyle, fontSize: 12 }}>
          o resumo leva ~30s pra ficar pronto. ele vai aparecer em{' '}
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>/aprovações</span> pra você revisar.
        </p>
      </div>
    </Modal>
  );
}

export default GenerateNowModal;
