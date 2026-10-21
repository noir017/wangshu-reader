// 朗读对话框：开始前的选项（TTS-001）、更多选项（TTS-006/007/008）、引擎与声音（TTS-014）、字符过滤表（TTS-008）。
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { TtsVoice } from '@shared/api';
import type { ReaderSession } from '@/core/reader-session';
import { Button, IconButton, openOverlay, Row, Select, Sheet, Switch, TextInput, toast } from '@/ui';
import { copyText } from '../common/clipboard';
import { tc } from '../common/messages';
import { openSessionOverlay } from '../common/overlay';
import { hasServerFeature } from '../common/server-features';
import css from '../common/features.module.css';
import { listServerVoices, listWebVoices, ServerTtsEngine, WebSpeechEngine, webSpeechSupported, type TtsEngine } from './engines';
import { DEFAULT_FILTERS, filtersToJson, parseFilters, type TtsFilter } from './filter';
import { tr } from './messages';
import { pitchOf, rateOf, volumeOf } from './params';
import { ttsSettings } from './settings';
import type { DivideMode } from './split';
import { voiceLabel } from './voices';

const divideOptions = (): { value: DivideMode; label: string }[] => [
  { value: 0, label: tr('divides0') },
  { value: 1, label: tr('divides1') },
  { value: 2, label: tr('divides2') },
  { value: 3, label: tr('divides3') },
];

/** 定时停止：勾选 + 分钟数 */
function StopTimerRow() {
  const s = ttsSettings.use((x) => x);
  return (
    <Row
      title={tr('stopTime1')}
      onClick={() => ttsSettings.set({ stopEnable: !s.stopEnable })}
      right={
        <>
          <span style={{ width: 64 }} onClick={(e) => e.stopPropagation()}>
            <TextInput type="number" value={String(s.stopTime)} onChange={(v) => ttsSettings.set({ stopTime: Math.max(1, Math.round(Number(v)) || 1) })} />
          </span>
          {tr('minutes')}
          <Switch checked={s.stopEnable} onChange={(v) => ttsSettings.set({ stopEnable: v })} />
        </>
      }
    />
  );
}

// ───────────── 开始朗读前的选项 ─────────────

function StartBody({ session, onStart, close }: { session: ReaderSession; onStart: () => void; close: () => void }) {
  const s = ttsSettings.use((x) => x);
  const [never, setNever] = useState(false);
  return (
    <Sheet
      open
      position="center"
      title={tr('options')}
      onClose={close}
      actions={
        <Button
          primary
          onClick={() => {
            if (never) ttsSettings.set({ askForTts: false });
            close();
            onStart();
          }}
        >
          {tr('start')}
        </Button>
      }
    >
      <Row title={tr('divide')} right={<Select value={s.divide} options={divideOptions()} onChange={(v) => ttsSettings.set({ divide: v })} />} />
      <StopTimerRow />
      <Row title={tr('engine')} subtitle={s.engine === 'server' ? tr('engineServer') : tr('engineWeb')} onClick={() => openTtsVoiceDialog(session)} right={tr('voice')} />
      <Row title={tr('askNever')} onClick={() => setNever((v) => !v)} right={<Switch checked={never} onChange={setNever} />} />
    </Sheet>
  );
}

export function openTtsStartDialog(session: ReaderSession, onStart: () => void): void {
  openSessionOverlay(session, (close) => <StartBody session={session} onStart={onStart} close={close} />);
}

// ───────────── 更多选项 ─────────────

function MoreBody({ session, close }: { session: ReaderSession; close: () => void }) {
  const s = ttsSettings.use((x) => x);
  return (
    <Sheet open position="center" title={tr('moreOptions')} onClose={close} actions={<Button primary onClick={close}>{tc('ok')}</Button>}>
      <Row title={tr('divide')} right={<Select value={s.divide} options={divideOptions()} onChange={(v) => ttsSettings.set({ divide: v })} />} />
      <Row title={tr('confirm')} onClick={() => ttsSettings.set({ askForTts: !s.askForTts })} right={<Switch checked={s.askForTts} onChange={(v) => ttsSettings.set({ askForTts: v })} />} />
      <StopTimerRow />
      <Row
        title={tr('interval')}
        onClick={() => ttsSettings.set({ intervalEnable: !s.intervalEnable })}
        right={
          <>
            <span style={{ width: 72 }} onClick={(e) => e.stopPropagation()}>
              <TextInput type="number" value={String(s.intervalTime)} onChange={(v) => ttsSettings.set({ intervalTime: Math.max(0, Math.round(Number(v)) || 0) })} />
            </span>
            {tr('ms')}
            <Switch checked={s.intervalEnable} onChange={(v) => ttsSettings.set({ intervalEnable: v })} />
          </>
        }
      />
      <Row title={tr('keepAwake')} onClick={() => ttsSettings.set({ keepAwake: !s.keepAwake })} right={<Switch checked={s.keepAwake} onChange={(v) => ttsSettings.set({ keepAwake: v })} />} />
      <Row title={tr('voice')} subtitle={s.engine === 'server' ? tr('engineServer') : tr('engineWeb')} onClick={() => openTtsVoiceDialog(session)} />
      <Row title={tr('filter')} onClick={() => openTtsFilterDialog(session)} />
      <div className={css.muted} style={{ padding: '6px 16px 12px', lineHeight: 1.5 }}>
        {tr('bgTip')}
      </div>
    </Sheet>
  );
}

export function openTtsMoreDialog(session: ReaderSession): void {
  openSessionOverlay(session, (close) => <MoreBody session={session} close={close} />);
}

// ───────────── 引擎与声音 ─────────────

function VoiceBody({ close }: { close: () => void }) {
  const s = ttsSettings.use((x) => x);
  const [serverOk, setServerOk] = useState(false);
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [serverVoices, setServerVoices] = useState<TtsVoice[]>([]);
  const preview = useRef<TtsEngine | null>(null);

  useEffect(() => {
    void hasServerFeature('tts').then((ok) => {
      setServerOk(ok);
      if (ok) void listServerVoices().then(setServerVoices);
    });
    void listWebVoices().then(setWebVoices);
    return () => preview.current?.destroy();
  }, []);

  // 引擎选项：服务端不可用时只隐藏该选项（当前设置仍是 server 时保留以免下拉空白）
  const engines: { value: 'web' | 'server'; label: string }[] = [];
  if (webSpeechSupported()) engines.push({ value: 'web', label: tr('engineWeb') });
  if (serverOk || s.engine === 'server') engines.push({ value: 'server', label: serverOk ? tr('engineServer') : tr('engineServerOff') });
  if (!engines.length) engines.push({ value: 'web', label: tr('engineWeb') });

  const server = s.engine === 'server';
  const voiceOptions = server
    ? [{ value: '', label: tr('voiceAuto') }, ...serverVoices.map((v) => ({ value: v.id, label: `${v.name} (${v.lang})` }))]
    : [{ value: '', label: tr('voiceAuto') }, ...webVoices.map((v) => ({ value: v.voiceURI, label: voiceLabel(v) }))];
  const voiceValue = server ? s.serverVoice : s.voiceURI;

  const play = () => {
    preview.current?.destroy();
    const e: TtsEngine = server ? new ServerTtsEngine() : new WebSpeechEngine();
    preview.current = e;
    const cur = ttsSettings.get();
    e.speak(
      tr('previewText'),
      { rate: rateOf(cur.speed), pitch: pitchOf(cur.pitch), volume: volumeOf(cur.volume), voice: server ? cur.serverVoice : cur.voiceURI, lang: '' },
      { onEnd: () => undefined, onError: (m) => toast(tr('failed', { msg: m })) },
    );
  };

  return (
    <Sheet open position="center" title={tr('options')} onClose={close} actions={<Button primary onClick={close}>{tc('ok')}</Button>}>
      <Row title={tr('engine')} right={<Select value={s.engine} options={engines} onChange={(v) => ttsSettings.set({ engine: v })} />} />
      <Row title={tr('voice')} right={<Select value={voiceValue} options={voiceOptions} onChange={(v) => ttsSettings.set(server ? { serverVoice: v } : { voiceURI: v })} />} />
      <Row title={tr('preview')} onClick={play} />
    </Sheet>
  );
}

export function openTtsVoiceDialog(session: ReaderSession): void {
  openSessionOverlay(session, (close) => <VoiceBody close={close} />);
}

// ───────────── 字符过滤表 ─────────────

function ImportBody({ onDone }: { onDone: (list: TtsFilter[] | null) => void }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <Sheet
      open
      position="center"
      title={tr('filterImportTitle')}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button onClick={() => onDone(null)}>{tc('cancel')}</Button>
          <Button
            primary
            onClick={() => {
              const list = parseFilters(text);
              if (!list) return setBad(true);
              onDone(list);
            }}
          >
            {tc('ok')}
          </Button>
        </>
      }
    >
      <div className={css.pad}>
        <textarea className={css.textarea} data-testid="filter-import-text" value={text} onChange={(e) => (setText(e.target.value), setBad(false))} autoFocus />
        {bad && <div className={css.warn}>{tr('filterImportBad')}</div>}
      </div>
    </Sheet>
  );
}

function FilterBody({ close }: { close: () => void }) {
  const s = ttsSettings.use((x) => x);
  const list = s.filters;
  const setList = (next: TtsFilter[]) => ttsSettings.set({ filters: next });
  const patch = (i: number, p: Partial<TtsFilter>) => setList(list.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const importRules = () =>
    new Promise<TtsFilter[] | null>((resolve) => {
      openOverlay((done) => <ImportBody onDone={(l) => (done(), resolve(l))} />);
    }).then((l) => {
      if (l) setList(l);
    });

  return (
    <Sheet
      open
      position="center"
      title={tr('filter')}
      onClose={close}
      headerRight={
        <IconButton label={tr('filterAdd')} onClick={() => setList([...list, { from: '', to: '' }])}>
          <Plus size={20} />
        </IconButton>
      }
      actions={<Button primary onClick={close}>{tc('ok')}</Button>}
    >
      <Row title={tr('filterRegex')} onClick={() => ttsSettings.set({ filterRegex: !s.filterRegex })} right={<Switch checked={s.filterRegex} onChange={(v) => ttsSettings.set({ filterRegex: v })} />} />
      <div className={css.pad} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 40px', gap: 6, alignItems: 'center' }} data-testid="filter-list">
        <div className={css.muted}>{tr('filterFrom')}</div>
        <div className={css.muted}>{tr('filterTo')}</div>
        <span />
        {list.map((f, i) => (
          <FilterRow key={i} f={f} onChange={(p) => patch(i, p)} onDelete={() => setList(list.filter((_, j) => j !== i))} />
        ))}
      </div>
      <div className={css.chips}>
        <button type="button" className={css.chip} onClick={() => setList(DEFAULT_FILTERS.map((x) => ({ ...x })))}>
          {tr('filterReset')}
        </button>
        <button
          type="button"
          className={css.chip}
          onClick={async () => toast((await copyText(filtersToJson(list))) ? tr('filterCopied') : tc('copyFailed'))}
        >
          {tr('filterExport')}
        </button>
        <button type="button" className={css.chip} onClick={() => void importRules()}>
          {tr('filterImport')}
        </button>
      </div>
    </Sheet>
  );
}

/** 过滤规则的原文/替换允许含空格（默认表里就有「 '」），输入框不能 trim */
function FilterRow({ f, onChange, onDelete }: { f: TtsFilter; onChange: (p: Partial<TtsFilter>) => void; onDelete: () => void }) {
  return (
    <>
      <input className={css.filterInput} data-testid="filter-from" value={f.from} onChange={(e) => onChange({ from: e.target.value })} />
      <input className={css.filterInput} data-testid="filter-to" value={f.to} onChange={(e) => onChange({ to: e.target.value })} />
      <IconButton label={tc('delete')} onClick={onDelete} style={{ width: 36, height: 36 }}>
        <Trash2 size={17} />
      </IconButton>
    </>
  );
}

export function openTtsFilterDialog(session: ReaderSession): void {
  openSessionOverlay(session, (close) => <FilterBody close={close} />);
}
