// 自定义阅读器工具栏（VIEW-004，ReaderBar）：20 个按钮勾选 + 排序 + 双行布局。
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button, Row, Sheet, Switch } from '@/ui';
import { normalizeToolbar, uiSettings } from '../ui-settings';
import { TOOL_META } from '../components/tool-meta';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export function ToolbarCustomizer({ close }: { close: () => void }) {
  const raw = uiSettings.use((u) => u.toolbar);
  const dbl = uiSettings.use((u) => u.doubleLineBar);
  const items = normalizeToolbar(raw);
  const save = (next: typeof items) => uiSettings.set({ toolbar: next });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  return (
    <Sheet open position="center" title={t('customize_bottom_bar')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <Row title={t('double_line_bar')} onClick={() => uiSettings.set({ doubleLineBar: !dbl })} right={<Switch checked={dbl} onChange={(v) => uiSettings.set({ doubleLineBar: v })} />} />
      <div className={s.noteText}>{t('customize_hint')}</div>
      {items.map((it, i) => {
        const meta = TOOL_META[it.id];
        const Icon = meta.icon;
        return (
          <div key={it.id} className={s.custRow}>
            <input type="checkbox" checked={it.on} onChange={() => save(items.map((x) => (x.id === it.id ? { ...x, on: !x.on } : x)))} aria-label={t(meta.label)} />
            <Icon size={20} />
            <span style={{ flex: 1 }}>{t(meta.label)}</span>
            <button type="button" className={s.rowGear} aria-label={t('move_up')} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className={s.rowGear} aria-label={t('move_down')} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={16} />
            </button>
          </div>
        );
      })}
    </Sheet>
  );
}
