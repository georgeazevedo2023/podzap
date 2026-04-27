'use client';

import type { ReactNode } from 'react';

export type AdminColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  mobileHide?: boolean;
};

export type AdminEntityListProps<T> = {
  rows: T[];
  columns: AdminColumn<T>[];
  getRowKey: (row: T) => string;
  mobileTitle: (row: T) => ReactNode;
  mobileSubtitle?: (row: T) => ReactNode;
  actions?: (row: T) => ReactNode;
  emptyState?: ReactNode;
};

export function AdminEntityList<T>({
  rows,
  columns,
  getRowKey,
  mobileTitle,
  mobileSubtitle,
  actions,
  emptyState,
}: AdminEntityListProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <div data-desktop-only data-as="flex" style={{ width: '100%' }}>
        <DesktopTable
          rows={rows}
          columns={columns}
          getRowKey={getRowKey}
          actions={actions}
        />
      </div>

      <div
        data-mobile-only
        data-as="flex"
        style={{
          flexDirection: 'column',
          gap: 12,
          width: '100%',
        }}
      >
        {rows.map((row) => (
          <MobileCard
            key={getRowKey(row)}
            row={row}
            columns={columns}
            mobileTitle={mobileTitle}
            mobileSubtitle={mobileSubtitle}
            actions={actions}
          />
        ))}
      </div>
    </>
  );
}

function DesktopTable<T>({
  rows,
  columns,
  getRowKey,
  actions,
}: {
  rows: T[];
  columns: AdminColumn<T>[];
  getRowKey: (row: T) => string;
  actions?: (row: T) => ReactNode;
}) {
  return (
    <div
      className="card"
      style={{ padding: 0, overflow: 'hidden', width: '100%' }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              background: 'var(--bg-2)',
              borderBottom: '2.5px solid var(--stroke)',
            }}
          >
            {columns.map((col) => (
              <Th key={col.key}>{col.label}</Th>
            ))}
            {actions && <Th>ações</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={getRowKey(row)}
              style={{
                borderBottom:
                  idx === rows.length - 1
                    ? undefined
                    : '1px solid var(--stroke)',
              }}
            >
              {columns.map((col) => (
                <Td key={col.key}>{col.render(row)}</Td>
              ))}
              {actions && (
                <Td>
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    {actions(row)}
                  </div>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileCard<T>({
  row,
  columns,
  mobileTitle,
  mobileSubtitle,
  actions,
}: {
  row: T;
  columns: AdminColumn<T>[];
  mobileTitle: (row: T) => ReactNode;
  mobileSubtitle?: (row: T) => ReactNode;
  actions?: (row: T) => ReactNode;
}) {
  const visible = columns.filter((c) => !c.mobileHide);
  return (
    <div
      className="card"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
          {mobileTitle(row)}
        </div>
        {mobileSubtitle && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {mobileSubtitle(row)}
          </div>
        )}
      </div>

      <dl
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          margin: 0,
        }}
      >
        {visible.map((col) => (
          <div
            key={col.key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <dt
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                margin: 0,
              }}
            >
              {col.label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--text)',
                textAlign: 'right',
                minWidth: 0,
              }}
            >
              {col.render(row)}
            </dd>
          </div>
        ))}
      </dl>

      {actions && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--stroke)',
          }}
        >
          {actions(row)}
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      style={{
        padding: '12px 16px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td
      style={{
        padding: '12px 16px',
        fontSize: 13,
        color: 'var(--text)',
      }}
    >
      {children}
    </td>
  );
}
