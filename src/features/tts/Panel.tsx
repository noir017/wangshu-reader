// 朗读面板（TTS-004/005/006）：底部浮层。音量/音调/语速滑块（松手生效）、重置、倒计时、上下页/句、播放暂停、停止、设置。
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronsLeft, ChevronsRight, Ellipsis, Pause, Play, Settings2, SkipBack, SkipForward, Square } from 'lucide-react';
import type { ReaderSession } from '@/core/reader-session';
import { popupMenu, promptDialog, Slider, toast } from '@/ui';
import css from '../common/features.module.css';
import { openTtsMoreDialog, openTtsVoiceDialog } from './Dialogs';
import { tr } from './messages';
import { canReset, countdownView, formatTimes, PITCH_MAX, sliderToPitch, sliderToSpeed, speedToSlider, SPEED_SLIDER_MAX } from './params';
import { getRunner, stopReading, useTts } from './service';
import { ttsSettings } from './settings';
import panel from './tts.module.css';

/** 拖动中先显示数值，松手才写设置（写设置会让朗读重来一句） */
function useDragValue(stored: number): [number, (v: number) => void, () => void] {
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setDrag(null), [stored]);
  return [drag ?? stored, setDrag, () => setDrag(null)];
}

function Countdown({ remaining }: { remaining: number }) {
  const v = countdownView(remaining);
  return (
    <button
      type="button"
      className={panel.countdown}
      data-urgent={v.urgent ? 'true' : undefined}
      data-testid="tts-countdown"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        popupMenu(r.left, r.top - 90, [
          {
            label: tr('changeTimer'),
            onSelect: async () => {
              const input = await promptDialog(tr('timerPrompt'), String(ttsSettings.get().stopTime), { type: 'number' });
              const n = Math.round(Number(input));
              if (input === null || !Number.isFinite(n) || n <= 0) return;
              ttsSettings.set({ stopTime: n });
              getRunner()?.setStopTimer(n);
            },
          },
          { label: tr('cancelTimer'), onSelect: () => getRunner()?.setStopTimer(null) },
        ]);
      }}
    >
      {v.text}
    </button>
  );
}

export function TtsPanel({ session }: { session: ReaderSession }) {
  const state = useTts((s) => s.state);
  const visible = useTts((s) => s.panel);
  const s = ttsSettings.use((x) => x);
  const [speed, setSpeed, endSpeed] = useDragValue(speedToSlider(s.speed));
  const [pitch, setPitch, endPitch] = useDragValue(s.pitch);
  if (!visible || state.status === 'idle') return null;

  const r = getRunner();
  const playing = state.status === 'playing';
  const once = state.once;

  return createPortal(
    <div className={panel.panel} data-testid="tts-panel" data-status={state.status} onPointerDown={(e) => e.stopPropagation()}>
      <div className={panel.sliders}>
        <Slider label={tr('volume')} value={s.volume} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => ttsSettings.set({ volume: v })} />
        <Slider
          label={tr('pitch')}
          value={pitch}
          min={0}
          max={PITCH_MAX}
          format={(v) => formatTimes(sliderToPitch(v))}
          onChange={setPitch}
          onCommit={(v) => {
            ttsSettings.set({ pitch: sliderToPitch(v) });
            endPitch();
          }}
        />
        <Slider
          label={tr('speed')}
          value={speed}
          min={0}
          max={SPEED_SLIDER_MAX}
          format={(v) => formatTimes(sliderToSpeed(v))}
          onChange={setSpeed}
          onCommit={(v) => {
            ttsSettings.set({ speed: sliderToSpeed(v) });
            endSpeed();
          }}
        />
      </div>
      <div className={panel.meta}>
        {canReset(s.speed, s.pitch) && (
          <button
            type="button"
            className={css.chip}
            data-testid="tts-reset"
            onClick={() => {
              ttsSettings.set({ speed: 10, pitch: 10 });
              toast('1.0×');
            }}
          >
            {tr('reset')}
          </button>
        )}
        <span className={css.grow} />
        {state.remaining !== null && <Countdown remaining={state.remaining} />}
      </div>
      <div className={panel.buttons}>
        <button type="button" aria-label={tr('pagePrev')} title={tr('pagePrev')} data-testid="tts-prev-page" disabled={once} onClick={() => void r?.prevPage()}>
          <ChevronsLeft size={22} />
        </button>
        <button type="button" aria-label={tr('sentencePrev')} title={tr('sentencePrev')} data-testid="tts-prev" onClick={() => void r?.prevSentence()}>
          <SkipBack size={20} />
        </button>
        <button type="button" aria-label={playing ? tr('pause') : tr('play')} title={playing ? tr('pause') : tr('play')} data-testid="tts-play" className={panel.play} onClick={() => void r?.toggle()}>
          {playing ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <button type="button" aria-label={tr('sentenceNext')} title={tr('sentenceNext')} data-testid="tts-next" onClick={() => void r?.nextSentence()}>
          <SkipForward size={20} />
        </button>
        <button type="button" aria-label={tr('pageNext')} title={tr('pageNext')} data-testid="tts-next-page" disabled={once} onClick={() => void r?.nextPage()}>
          <ChevronsRight size={22} />
        </button>
        <button type="button" aria-label={tr('stop')} title={tr('stop')} data-testid="tts-stop" onClick={() => stopReading()}>
          <Square size={20} />
        </button>
        <button type="button" aria-label={tr('options')} title={tr('options')} data-testid="tts-settings" onClick={() => openTtsVoiceDialog(session)}>
          <Settings2 size={20} />
        </button>
        <button type="button" aria-label={tr('moreOptions')} title={tr('moreOptions')} data-testid="tts-more" onClick={() => openTtsMoreDialog(session)}>
          <Ellipsis size={20} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
