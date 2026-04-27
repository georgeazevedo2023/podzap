import { TopBar } from '@/components/shell/TopBar';
import { listAllTracks } from '@/lib/admin/music';

import { MusicTable } from './MusicTable';

/**
 * Tela do superadmin pra gerenciar o catálogo de músicas de fundo
 * (`music_tracks`). CRUD completo: list, upload, edit, toggle active,
 * delete. Cross-tenant — tracks são globais.
 *
 * Sentinels (`none`) e builtins (`default`, `chillout`, etc.) só
 * permitem editar metadata cosmética; toggle e delete ficam só pra
 * uploads.
 */
export default async function AdminMusicPage() {
  const tracks = await listAllTracks();

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Músicas de fundo"
        subtitle="catálogo global · upload de tracks pra todos os tenants"
        accent="purple"
        breadcrumb="admin"
      />

      <div
        style={{
          padding: '28px 36px 40px',
          maxWidth: 1240,
        }}
      >
        <MusicTable tracks={tracks} />
      </div>
    </div>
  );
}
