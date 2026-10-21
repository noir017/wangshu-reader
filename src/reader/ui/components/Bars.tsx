// 顶栏、底栏（进度条 + 章节切换 + 百分比 + 回退 + 工具按钮行），VIEW-002 / VIEW-003 / VIEW-004。
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, EllipsisVertical, Undo2 } from 'lucide-react';
import { navigate } from '@/core/router';
import { Slider as _s, promptDialog, toast } from '@/ui';
import { controlSettings } from '@/reader/settings';
import { normalizeToolbar, uiSettings } from '../ui-settings';
import { useHost } from '../context';
import { goLinkBack, goToProgress, parsePercentInput, percentText, saveLinkBack, stepChapter } from '../ops';
import { useReaderUi } from '../store';
import { TOOL_META } from './tool-meta';
import { toolClick, toolLongPress } from './tool-actions';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export function barTitle(rec: { fileName: string; title: string; authors: string[]; format: string }): string {
  // TXT 显示文件名，其余「书名 - 作者」
  if (rec.format === 'txt') return rec.fileName;
  return rec.authors.length ? `${rec.title} - ${rec.authors.join(', ')}` : rec.title;
}

export function TopBar() {
  const host = useHost();
  const menu = useReaderUi((x) => x.menu);
  const rec = useReaderUi((x) => x.session?.record);
  return (
    <div className={s.top} data-show={menu} inert={!menu}>
      <button type="button" className={s.barBtn} style={{ color: '#fff' }} aria-label={t('back')} onClick={() => host.backToShelf()}>
        <ArrowLeft size={22} />
      </button>
      <button type="button" className={s.title} onClick={() => host.bookInfo()}>
        {rec ? barTitle(rec) : ''}
      </button>
      <button type="button" className={s.barBtn} style={{ color: '#fff' }} aria-label={t('menu_more')} onClick={() => host.optionsMenu()}>
        <EllipsisVertical size={22} />
      </button>
    </div>
  );
}

export function BottomBar() {
  const menu = useReaderUi((x) => x.menu);
  const loc = useReaderUi((x) => x.loc);
  const canBack = useReaderUi((x) => x.linkBack.length > 0);
  const [drag, setDrag] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const started = useRef(false);

  const value = drag ?? seekValue(loc?.progress ?? 0, loc?.atEnd ?? false);
  const pct = drag !== null ? `${(drag / 10).toFixed(1)}%` : percentText(loc?.progress ?? 0, loc?.atEnd ?? false);

  const jump = (v: number, immediate = false) => {
    clearTimeout(timer.current);
    if (immediate) void goToProgress(v / 1000);
    else timer.current = setTimeout(() => void goToProgress(v / 1000), 90);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={s.bottom} data-show={menu} inert={!menu}>
      <div className={s.seekRow}>
        <button type="button" className={s.barBtn} aria-label={t('prior_chapter')} onClick={() => void stepChapter(-1)}>
          <ChevronLeft size={22} />
        </button>
        <input
          className={s.seek}
          type="range"
          min={0}
          max={1000}
          value={value}
          aria-label={t('go_percent')}
          onPointerDown={() => {
            started.current = false;
          }}
          onChange={(e) => {
            const v = Number(e.target.value);
            // 开始拖动前记录原位置，「↩」一键回去
            if (!started.current) {
              started.current = true;
              saveLinkBack();
            }
            setDrag(v);
            jump(v);
          }}
          onPointerUp={(e) => {
            if (drag !== null) jump(Number((e.target as HTMLInputElement).value), true);
            setDrag(null);
          }}
          onKeyUp={(e) => {
            if (drag !== null) jump(Number((e.target as HTMLInputElement).value), true);
            setDrag(null);
          }}
        />
        <button
          type="button"
          className={s.pct}
          onClick={async () => {
            const raw = await promptDialog(t('go_percent_title'), '', { placeholder: pct });
            if (raw === null) return;
            const p = parsePercentInput(raw);
            if (p === null) return void toast(t('go_percent_title'));
            saveLinkBack();
            void goToProgress(p);
          }}
        >
          {pct}
        </button>
        <button type="button" className={s.barBtn} aria-label={t('link_back')} disabled={!canBack} onClick={() => void goLinkBack()}>
          <Undo2 size={20} />
        </button>
        <button type="button" className={s.barBtn} aria-label={t('next_chapter')} onClick={() => void stepChapter(1)}>
          <ChevronRight size={22} />
        </button>
      </div>
      <ToolRow />
    </div>
  );
}

/** 进度条值 0..1000：>0 取整为 0 时取 1，末页强制 1000（STATUS-005） */
export function seekValue(progress: number, atEnd: boolean): number {
  if (atEnd) return 1000;
  const v = Math.round(Math.max(0, Math.min(1, progress)) * 1000);
  return v === 0 && progress > 0 ? 1 : v;
}

function ToolRow() {
  const host = useHost();
  const raw = uiSettings.use((u) => u.toolbar);
  const dbl = uiSettings.use((u) => u.doubleLineBar);
  const tilt = controlSettings.use((c) => c.tiltTurnPage);
  const items = normalizeToolbar(raw).filter((i) => i.on);
  // 双行：勾选数为奇数时补一个空位，前一半放第一行
  const half = Math.ceil(items.length / 2);
  const rows = dbl && items.length > 1 ? [items.slice(0, half), items.slice(half)] : [items];
  return (
    <>
      {rows.map((row, ri) => (
        <div key={ri} className={s.tools}>
          {row.map((it) => (
            <ToolBtn key={it.id} id={it.id} on={it.id === 9 && tilt} onClick={() => toolClick(it.id, host)} onLong={(a) => toolLongPress(it.id, host, a)} />
          ))}
          {dbl && row.length < half && <span className={s.toolBtn} />}
        </div>
      ))}
    </>
  );
}

function ToolBtn(props: { id: number; on?: boolean; onClick: () => void; onLong: (a: { x: number; y: number }) => void }) {
  const meta = TOOL_META[props.id];
  const Icon = meta.icon;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  return (
    <button
      type="button"
      className={s.toolBtn}
      data-on={props.on ? 'true' : undefined}
      aria-label={t(meta.label)}
      title={t(meta.label)}
      onPointerDown={(e) => {
        fired.current = false;
        const el = e.currentTarget.getBoundingClientRect();
        timer.current = setTimeout(() => {
          fired.current = true;
          props.onLong({ x: el.left + el.width / 2, y: el.top });
        }, 500);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onPointerCancel={() => clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (!fired.current) props.onClick();
        fired.current = false;
      }}
    >
      <Icon size={22} />
    </button>
  );
}

void navigate;
void _s;
