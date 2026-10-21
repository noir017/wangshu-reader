// 文件夹快速访问列表（LIB-029）：服务端书库里的目录路径，首页「我的文件」行与文件页使用
import { Folder, Plus, X } from 'lucide-react';
import { Button, Sheet, openOverlay, promptDialog, Switch, Row } from '@/ui';
import { filesSettings } from '../settings';
import { t } from '../i18n';
import s from '../library.module.css';

export function addFavFolder(path: string): void {
  const cur = filesSettings.get().favFolders;
  if (!cur.includes(path)) filesSettings.set({ favFolders: [...cur, path] });
}

export function removeFavFolder(path: string): void {
  filesSettings.set({ favFolders: filesSettings.get().favFolders.filter((p) => p !== path) });
}

export function openFavFolders(): void {
  openOverlay((close) => <FavFoldersDialog onClose={close} />);
}

function FavFoldersDialog({ onClose }: { onClose: () => void }) {
  const list = filesSettings.use((x) => x.favFolders);
  const showDav = filesSettings.use((x) => x.showDavInFavorites);
  return (
    <Sheet
      open
      position="center"
      title={t('filesFavorites')}
      onClose={onClose}
      actions={
        <>
          <Button
            onClick={async () => {
              const p = await promptDialog(t('filesFolderName'), '', { placeholder: 'Books/Novels' });
              if (p?.trim()) addFavFolder(p.trim().replace(/^\/+|\/+$/g, ''));
            }}
          >
            <Plus size={14} style={{ verticalAlign: -2 }} /> {t('filesAddFav')}
          </Button>
          <Button primary onClick={onClose}>
            {t('ok')}
          </Button>
        </>
      }
    >
      <Row title="[WebDav]" right={<Switch checked={showDav} onChange={(v) => filesSettings.set({ showDavInFavorites: v })} />} />
      {list.length === 0 && <div className={`${s.pad} ${s.dim}`}>{t('filesEmpty')}</div>}
      {list.map((p) => (
        <Row key={p} icon={<Folder size={18} />} title={p || t('filesRoot')} right={<button className={s.moreBtn} aria-label={t('filesRemoveFav')} onClick={() => removeFavFolder(p)}><X size={16} /></button>} />
      ))}
    </Sheet>
  );
}
