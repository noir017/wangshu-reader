// 自动滚屏的控制（AUTO-001）：开始/停止/暂停/调速 + 「选择自动滚屏模式」对话框。滚动本身由引擎做。
// 速读模式（RSVP）由 SpeedRead 组件接管，这里只负责打开它。
import { useState } from 'react';
import { AutoScrollMode, autoScrollSettings } from '@/reader/settings';
import { Button, Row, Select, Sheet, Slider, Switch, openOverlay, toast } from '@/ui';
import { uiSettings } from './ui-settings';
import { t } from './messages';
import { getSession } from './ops';
import { useReaderUi } from './store';

export const SCROLL_MODES = [0, 1, 2, 3, 4, AutoScrollMode.SpeedRead] as const;

export function isAutoActive(): boolean {
  const s = useReaderUi.getState();
  return s.autoRunning || s.autoPaused || s.speedRead;
}

/** 速度百分比显示：滑条值 = 100 − speed */
export const speedPct = (speed: number): number => 100 - speed;

export function startAutoScroll(): void {
  const s = getSession();
  if (!s) return;
  const ui = useReaderUi.getState();
  ui.setMenu(false);
  ui.setPanel(null);
  if (autoScrollSettings.get().autoScrollMode === AutoScrollMode.SpeedRead) {
    ui.setSpeedRead(true);
    return;
  }
  ui.setAuto({ running: true, paused: false });
  s.controller.startAutoScroll();
  if (uiSettings.get().askAutoScrollTip) {
    uiSettings.set({ askAutoScrollTip: false });
    toast(t('scroll_tip'), 4500);
  }
}

export function stopAutoScroll(opts: { silent?: boolean } = {}): void {
  const ui = useReaderUi.getState();
  const was = ui.autoRunning || ui.autoPaused;
  ui.setAuto({ running: false, paused: false });
  ui.setSpeedRead(false);
  const c = getSession()?.controller;
  try {
    if (c?.isAutoScrolling()) c.stopAutoScroll();
  } catch {
    /* 引擎还没 open 完（React 严格模式下 effect 会立刻清理一次）：没有滚屏可停 */
  }
  if (was && !opts.silent) toast(t('scroll_cancel'));
}

/**
 * 单击：暂停/继续。滚屏运行时触摸由引擎自己处理（单击暂停/继续、上下拖调速、横拖停止，都不再上报 tap），
 * 所以界面侧只会在「已暂停」时走到这里（继续）；运行中走到这里没有对应的引擎接口，只能整个停止
 */
export function pauseOrResume(): void {
  const ui = useReaderUi.getState();
  const c = getSession()?.controller;
  if (!c) return;
  if (ui.autoPaused) c.startAutoScroll(); // 引擎已开启但暂停时，start() 是原地继续
  else if (ui.autoRunning) stopAutoScroll();
}

/** 速度 ±（原版每 20dp 一档）：delta > 0 加快 */
export function changeSpeed(delta: number): void {
  const cur = autoScrollSettings.get().autoScrollSpeed;
  const next = Math.max(0, Math.min(100, cur - delta));
  if (next === cur) return;
  autoScrollSettings.set({ autoScrollSpeed: next });
  toast(t('scroll_speed', { n: speedPct(next) }), 800);
}

let lastEngineSpeed: number | null = null;

/**
 * 引擎 autoScroll 事件 → 界面状态。running=滚动中；paused=已开启但暂停（点击正文可继续）；两者都为 false = 真正停止
 * （横拖停止、到书末）。界面自己停止时已先清掉状态，引擎随后回报的「停止」不会再提示。
 */
export function onEngineAutoScroll(e: { running: boolean; paused?: boolean; speed?: number }): void {
  const ui = useReaderUi.getState();
  if (e.running) {
    ui.setAuto({ running: true, paused: false });
    if (e.speed !== undefined && lastEngineSpeed !== null && e.speed !== lastEngineSpeed) toast(t('scroll_speed', { n: speedPct(e.speed) }), 800);
  } else if (e.paused) {
    if (!ui.autoPaused) {
      ui.setAuto({ running: false, paused: true });
      toast(t('pause'));
    }
  } else if (ui.autoRunning || ui.autoPaused) {
    ui.setAuto({ running: false, paused: false });
    if (!ui.loc?.atEnd) toast(t('scroll_cancel')); // 到书末由 endOfBook 事件提示
  }
  if (e.speed !== undefined) lastEngineSpeed = e.speed;
}

/** 开始自动滚屏（点按钮/动作 18/导航菜单）：首次询问模式与速度 */
export function toggleAutoScroll(): void {
  if (isAutoActive()) {
    stopAutoScroll();
    return;
  }
  if (uiSettings.get().askForScrollEvent) openScrollAsk();
  else startAutoScroll();
}

export function openScrollAsk(): void {
  openOverlay((close) => <ScrollAsk close={close} />);
}

function ScrollAsk({ close }: { close: () => void }) {
  const mode = autoScrollSettings.use((s) => s.autoScrollMode);
  const speed = autoScrollSettings.use((s) => s.autoScrollSpeed);
  const ask = uiSettings.use((u) => u.askForScrollEvent);
  const [dummy] = useState(0);
  void dummy;
  return (
    <Sheet
      open
      position="center"
      title={t('scroll_ask_title')}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>{t('cancel')}</Button>
          <Button
            primary
            onClick={() => {
              close();
              startAutoScroll();
            }}
          >
            {t('start')}
          </Button>
        </>
      }
    >
      <Row
        title={t('scroll_mode')}
        right={
          <Select
            value={mode as number}
            options={SCROLL_MODES.map((v) => ({ value: v as number, label: t(`scroll_mode_${v}` as 'scroll_mode_0') }))}
            onChange={(v) => autoScrollSettings.set({ autoScrollMode: v as 0 })}
          />
        }
      />
      <Slider
        label={t('scroll_speed_label')}
        value={speedPct(speed)}
        min={0}
        max={100}
        format={(v) => `${v}%`}
        onChange={(v) => autoScrollSettings.set({ autoScrollSpeed: 100 - v })}
      />
      <Row title={t('do_not_ask_again')} onClick={() => uiSettings.set({ askForScrollEvent: !ask })} right={<Switch checked={!ask} onChange={(v) => uiSettings.set({ askForScrollEvent: !v })} />} />
    </Sheet>
  );
}
