'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Icons } from '@/components/icons/Icons';
import { Modal } from '@/components/ui/Modal';
import { RadioPill } from '@/components/ui/RadioPill';
import { Select } from '@/components/ui/Select';

type Tone = 'formal' | 'fun' | 'corporate';
type Period = '24h' | '7d';

interface GroupOption {
  id: string;
  name: string;
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
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset + load monitored groups on open.
  useEffect(() => {
    if (!open) return;

    setError(null);
    setSubmitting(false);
    setFetching(true);

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
        body: JSON.stringify({ groupId, periodStart, periodEnd, tone }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
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
  const canSubmit = hasGroups && !!groupId && !submitting && !fetching;

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

        {error ? <div style={errorBoxStyle}>{error}</div> : null}

        <p style={{ ...mutedStyle, fontSize: 12 }}>
          o resumo leva ~30s pra ficar pronto. ele vai aparecer em{' '}
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>/aprovações</span> pra você revisar.
        </p>
      </div>
    </Modal>
  );
}

export default GenerateNowModal;
