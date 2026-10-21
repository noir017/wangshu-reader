// 背景图选择（PrefImageBrowser1，THEME-006）：内置程序纹理 + 用户上传的图片（存 kv，id img:<键>）。
import { useEffect, useState, type CSSProperties } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { textSettings } from '@/reader/settings';
import { Button, GroupTitle, Sheet, confirmDialog, openOverlay, toast } from '@/ui';
import { addUserImage, listTextures, listUserImages, removeUserImage, resolveBackground, textureStyleSync, userImageId, type UserImage } from '../themes/background';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export function openBackgroundPicker(): void {
  openOverlay((close) => <BackgroundPicker close={close} />);
}

/** 上传前把过大的图缩到长边 ≤ 2048，避免撑爆 IndexedDB 配额 */
async function shrink(file: File): Promise<Blob> {
  if (file.size < 1_500_000 || typeof createImageBitmap === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    if (k >= 1) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.9));
  } catch {
    return file;
  }
}

function pick(id: string) {
  textSettings.set({ useBackgroundImage: true, backgroundImage: id });
}

function UserTile({ img, active, onDelete }: { img: UserImage; active: boolean; onDelete: () => void }) {
  const [style, setStyle] = useState<CSSProperties>({});
  const id = userImageId(img.key);
  useEffect(() => {
    void resolveBackground({ useBackgroundImage: true, backgroundImage: id, backgroundColor: '#888' }).then(setStyle);
  }, [id]);
  return (
    <button
      type="button"
      className={s.bgTile}
      data-active={active ? 'true' : undefined}
      style={{ ...style, backgroundSize: 'cover' }}
      onClick={() => pick(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onDelete();
      }}
      title={img.name}
    >
      <span className={s.bgTileName}>{img.name}</span>
    </button>
  );
}

function BackgroundPicker({ close }: { close: () => void }) {
  const cur = textSettings.use((st) => (st.useBackgroundImage ? st.backgroundImage : ''));
  const [users, setUsers] = useState<UserImage[]>([]);
  const reload = () => void listUserImages().then(setUsers);
  useEffect(reload, []);

  const upload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const id = await addUserImage(await shrink(f), f.name);
        pick(id);
        reload();
      } catch {
        toast(t('bg_upload_failed'));
      }
    };
    input.click();
  };

  return (
    <Sheet open position="center" title={t('bg_pick_title')} onClose={close} actions={<Button onClick={upload}><Upload size={16} /> {t('bg_upload')}</Button>}>
      {users.length > 0 && (
        <>
          <GroupTitle>{t('bg_user_images')}</GroupTitle>
          <div className={s.bgGrid}>
            {users.map((u) => (
              <UserTile
                key={u.key}
                img={u}
                active={cur === userImageId(u.key)}
                onDelete={async () => {
                  if (!(await confirmDialog(t('bg_delete_confirm')))) return;
                  await removeUserImage(userImageId(u.key));
                  if (cur === userImageId(u.key)) textSettings.set({ useBackgroundImage: false, backgroundImage: '' });
                  reload();
                }}
              />
            ))}
          </div>
        </>
      )}
      <GroupTitle>{t('bg_builtin')}</GroupTitle>
      <div className={s.bgGrid}>
        {listTextures().map((tex) => (
          <button
            key={tex.id}
            type="button"
            className={s.bgTile}
            data-active={cur === tex.id ? 'true' : undefined}
            style={textureStyleSync(tex.id, tex.avgColor)}
            onClick={() => pick(tex.id)}
            title={tex.name}
          >
            <span className={s.bgTileName}>{tex.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
