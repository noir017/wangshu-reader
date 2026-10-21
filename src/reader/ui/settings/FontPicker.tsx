// 字体选择（PrefFontPick，TYPO-002）：内置 serif/sans/mono、用户导入的字体、服务端字体；每项用该字体渲染示例文本。
import { useEffect, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import type { FontRecord } from '@/core/library';
import { hasServer } from '@/core/server';
import type { ServerFont } from '@shared/api';
import { listFonts } from '@/storage/db';
import { Button, GroupTitle, IconButton, Sheet, confirmDialog, openOverlay, toast } from '@/ui';
import { addFontFile, ensureFont, listServerFonts, registerFontRecord, removeFont } from '../services/fonts';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export interface FontPickTarget {
  get(): string;
  set(v: string): void;
}

export function openFontPicker(target: FontPickTarget): void {
  openOverlay((close) => <FontPicker target={target} close={close} />);
}

function FontPicker({ target, close }: { target: FontPickTarget; close: () => void }) {
  const [records, setRecords] = useState<FontRecord[]>([]);
  const [server, setServer] = useState<ServerFont[]>([]);
  const [cur, setCur] = useState(target.get());

  const reload = async () => {
    const list = await listFonts();
    setRecords(list);
    list.forEach((r) => void registerFontRecord(r));
  };
  useEffect(() => {
    void reload();
    if (hasServer()) void listServerFonts().then(async (l) => {
      setServer(l);
      for (const f of l) void ensureFont(`server:${f.file}`);
    });
  }, []);

  const choose = (v: string) => {
    target.set(v);
    setCur(v);
    void ensureFont(v);
  };

  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.ttc,.woff,.woff2,font/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const rec = await addFontFile(f);
        toast(t('font_import_done', { name: rec.family }));
        await reload();
        choose(`font:${rec.id}`);
      } catch {
        toast(t('font_import_failed'));
      }
    };
    input.click();
  };

  const row = (value: string, name: string, family: string, extra?: React.ReactNode) => (
    <div key={value} className={s.fontRow} data-active={cur === value ? 'true' : undefined} onClick={() => choose(value)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={s.fontSample} style={{ fontFamily: family }}>
          {t('font_sample')}
        </div>
        <div className={s.fontName}>{name}</div>
      </div>
      {extra}
    </div>
  );

  return (
    <Sheet open position="center" title={t('font_pick_title')} onClose={close} actions={<Button onClick={importFile}><Upload size={16} /> {t('font_import')}</Button>}>
      <GroupTitle>{t('font_builtin')}</GroupTitle>
      {row('serif', t('font_serif'), 'serif')}
      {row('sans-serif', t('font_sans'), 'sans-serif')}
      {row('monospace', t('font_mono'), 'monospace')}
      {records.length > 0 && <GroupTitle>{t('font_imported')}</GroupTitle>}
      {records.map((r) =>
        row(
          `font:${r.id}`,
          r.family,
          `"${r.family}", serif`,
          <IconButton
            label={t('delete')}
            onClick={async (e) => {
              e.stopPropagation();
              if (!(await confirmDialog(t('font_delete_confirm', { name: r.family })))) return;
              await removeFont(r.id);
              if (cur === `font:${r.id}`) choose('serif');
              await reload();
            }}
          >
            <Trash2 size={16} />
          </IconButton>,
        ),
      )}
      {server.length > 0 && <GroupTitle>{t('font_server')}</GroupTitle>}
      {server.map((f) => row(`server:${f.file}`, f.family, `"${f.family}", serif`))}
    </Sheet>
  );
}
