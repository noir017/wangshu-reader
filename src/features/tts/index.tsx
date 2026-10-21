// 朗读宿主：监听 tts.toggle / tts.stop / tts.menu 命令，渲染朗读面板（TTS-001/004）。
import { useEffect } from 'react';
import { useReaderSession, type ReaderSession } from '@/core/reader-session';
import type { Locator } from '@/core/book';
import { popupMenu, toast } from '@/ui';
import { normalizeSelectedText } from '../common/clipboard';
import { useBus } from '../common/hooks';
import { openTtsStartDialog } from './Dialogs';
import { tr } from './messages';
import { TtsPanel } from './Panel';
import { destroyTts, getRunner, speakText, startReading, stopReading } from './service';
import { ttsSettings } from './settings';
import { peekSelection } from '../common/safe';

/** 朗读按钮（动作 19）：朗读中=暂停/继续；有选区=只读选区；否则按设置先弹选项再开始 */
export async function toggleTts(session: ReaderSession, from?: Locator): Promise<void> {
  const r = getRunner();
  const st = r?.state.status ?? 'idle';
  if (r && (st === 'playing' || st === 'paused')) return void (await r.toggle());
  const sel = peekSelection(session.controller);
  if (sel && sel.text.trim()) {
    session.controller.setSelection(null);
    return void (await speakText(session, normalizeSelectedText(sel.text)));
  }
  if (ttsSettings.get().askForTts) openTtsStartDialog(session, () => void startReading(session, from));
  else await startReading(session, from);
}

/** 朗读按钮长按菜单（doSpeakLongTap）：开始朗读 / 开始朗读(N分钟) / 朗读剪贴板文本 */
export function openSpeakMenu(session: ReaderSession, x = window.innerWidth / 2, y = window.innerHeight / 2): void {
  const minutes = ttsSettings.get().stopTime;
  popupMenu(x, y, [
    { label: tr('start'), onSelect: () => void startReading(session, undefined, { stopMinutes: null }) },
    { label: tr('startTimer', { n: minutes }), onSelect: () => void startReading(session, undefined, { stopMinutes: minutes }) },
    {
      label: tr('clipboard'),
      onSelect: async () => {
        let text = '';
        try {
          text = await navigator.clipboard.readText();
        } catch {
          return toast(tr('clipboardDenied'));
        }
        if (!text.trim()) return toast(tr('clipboardEmpty'));
        await speakText(session, text);
      },
    },
  ]);
}

export function TtsHost() {
  const session = useReaderSession();
  useBus('tts.toggle', ({ from }) => void toggleTts(session, from));
  useBus('tts.stop', () => stopReading());
  // reader/ui 的朗读按钮长按时发，可带 x/y
  useBus('tts.menu', (p) => openSpeakMenu(session, p.x, p.y));
  // 离开阅读页/换书：停止朗读、释放引擎与 Media Session
  useEffect(() => () => destroyTts(), [session]);
  return <TtsPanel session={session} />;
}
