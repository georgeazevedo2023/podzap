'use client';

import { useEffect, useState, useTransition } from 'react';

import { Sticker } from '@/components/ui/Sticker';

/**
 * Fase 10 — minimal delivery-settings card.
 *
 * Shows two per-tenant toggles and persists changes via
 * `PATCH /api/settings`. Deliberately lightweight: no design-system
 * switch component yet, just a checkbox + a radio triplet, with
 * graceful degradation if the endpoint fails.
 *
 * Why it lives under `app/(app)/home`: for now the only place we
 * surface settings is the Home dashboard. When a full `/settings`
 * page lands, this component can move there untouched.
 */

type DeliveryTarget = 'group' | 'owner_dm' | 'both';

type Settings = {
  includeCaptionOnDelivery: boolean;
  deliveryTarget: DeliveryTarget;
};

const TARGET_LABELS: Record<DeliveryTarget, string> = {
  group: 'grupo original',
  owner_dm: 'DM do dono',
  both: 'grupo + DM',
};

export function SettingsCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as { settings: Settings };
        if (!cancelled) {
          setSettings(body.settings);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (changes: Partial<Settings>) => {
    if (!settings) return;
    // Optimistic update — we roll back on failure.
    const previous = settings;
    const next = { ...settings, ...changes };
    setSettings(next);
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(changes),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as { settings: Settings };
        setSettings(body.settings);
      } catch (err) {
        setSettings(previous);
        setError(err instanceof Error ? err.message : 'update failed');
      }
    });
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          carregando preferências…
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            marginBottom: 8,
          }}
        >
          entrega
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          configurações indisponíveis{error ? ` (${error})` : ''}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}
        >
          entrega
        </div>
        <Sticker variant="lime">fase 10</Sticker>
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 14,
          cursor: pending ? 'progress' : 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={settings.includeCaptionOnDelivery}
          disabled={pending}
          onChange={(e) =>
            patch({ includeCaptionOnDelivery: e.currentTarget.checked })
          }
        />
        enviar legenda com o áudio
      </label>

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          marginBottom: 6,
        }}
      >
        destino
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(Object.keys(TARGET_LABELS) as DeliveryTarget[]).map((target) => (
          <label
            key={target}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: pending ? 'progress' : 'pointer',
            }}
          >
            <input
              type="radio"
              name="deliveryTarget"
              value={target}
              checked={settings.deliveryTarget === target}
              disabled={pending}
              onChange={() => patch({ deliveryTarget: target })}
            />
            {TARGET_LABELS[target]}
          </label>
        ))}
      </div>

      {error ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: 'var(--red-500, #b00020)',
          }}
        >
          falhou: {error}
        </div>
      ) : null}
    </div>
  );
}
