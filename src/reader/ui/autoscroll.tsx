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

/** 单击：暂停/继续。引擎没有暂停接口，暂停 = 停止滚动但保留「已暂停」状态，继续 = 重新开始 */
export function pauseOrResume(): void {
  const ui = useReaderUi.getState();
  const c = getSession()?.controller;
  if (!c) return;
  if (ui.autoPaused) {
    ui.setAuto({ running: true, paused: false });
    c.startAutoScroll();
  } else if (ui.autoRunning) {
    ui.setAuto({ paused: true });
    c.stopAutoScroll();
    toast(t('pause'));
  }
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
 * 引擎 autoScroll 事件 → 界面状态。滚屏运行时，点击暂停/继续、上下拖调速、横拖停止都由引擎自己处理（它不再上报 tap），
 * 暂停和停止对外是同一个 {running:false}，没法区分：界面主动停止时已先清掉状态，所以这里凡是「界面以为在滚、引擎说没在滚」
 * 都当作暂停（再点一下由 tap 走 pauseOrResume 继续）。已知局限见汇报：引擎应在事件里带上 paused。
 */
export function onEngineAutoScroll(running: boolean, speed?: number): void {
  const ui = useReaderUi.getState();
  if (running) {
    ui.setAuto({ running: true, paused: false });
    if (speed !== undefined && lastEngineSpeed !== null && speed !== lastEngineSpeed) toast(t('scroll_speed', { n: speedPct(speed) }), 800);
  } else if (ui.autoRunning) {
    ui.setAuto({ running: false, paused: true });
    toast(t('pause'));
  }
  if (speed !== undefined) lastEngineSpeed = speed;
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
