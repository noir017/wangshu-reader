// 三个大设置对话框的入口：可视选项 ↔ 控制选项 ↔ 其它选项互相跳转（VIEW-009）。
// 固定版式（PDF/漫画）的「可视选项」是 PDF 选项。
import { openOverlay } from '@/ui';
import { useReaderUi } from '../store';
import { ControlOptions } from './ControlOptions';
import { MiscOptions } from './MiscOptions';
import { PdfOptions } from './PdfOptions';
import { VisualOptions, type SettingsKind } from './VisualOptions';

let closeCurrent: (() => void) | undefined;

export function openSettings(kind: SettingsKind): void {
  closeCurrent?.();
  const fixed = useReaderUi.getState().session?.book.kind === 'fixed';
  closeCurrent = openOverlay((close) => {
    const done = () => {
      if (closeCurrent === close) closeCurrent = undefined;
      close();
    };
    const sw = (k: SettingsKind) => openSettings(k);
    if (kind === 'control') return <ControlOptions close={done} onSwitch={sw} />;
    if (kind === 'misc') return <MiscOptions close={done} onSwitch={sw} />;
    return fixed ? <PdfOptions close={done} onSwitch={sw} /> : <VisualOptions close={done} onSwitch={sw} />;
  });
}

export function closeSettings(): void {
  closeCurrent?.();
  closeCurrent = undefined;
}
