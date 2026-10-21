// 查词/翻译内联卡片（DICT-002 内联卡片 / DICT-004 / DICT-007）：贴着选区，上下避让。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Languages, BookText, Volume2, X } from 'lucide-react';
import type { DictResponse } from '@shared/api';
import { appSettings } from '@/core/app-settings';
import { apiJson, hasServer } from '@/core/server';
import { IconButton, Select, toast } from '@/ui';
import { copyText } from '../common/clipboard';
import { useFocusAndEscape } from '../common/hooks';
import { placeNear, type Placement } from '../common/position';
import { sanitizeHtml } from '../common/sanitize';
import { hasServerFeature, serverUrl } from '../common/server-features';
import { tc } from '../common/messages';
import css from '../common/features.module.css';
import { closeLookupCard, fallbackSources, openUrl, type LookupRequest } from './lookup';
import { td } from './messages';
import { dictSettings } from './settings';
import { fillUrl, TRANSLATE_LANGS, translateUrl } from './sources';
import { listTranslateProviders, translateText } from './translate';

type DictState =
  | { status: 'loading' }
  | { status: 'ok'; data: DictResponse }
  | { status: 'empty' }
  | { status: 'no-server'; reason: 'no-server' | 'no-feature' }
  | { status: 'error'; message: string };

type TransState = { status: 'loading' } | { status: 'ok'; text: string; provider: string; detected?: string } | { status: 'fail'; reason: 'no-server' | 'error'; message: string };

export function LookupCard({ req }: { req: LookupRequest }) {
  const [mode, setMode] = useState(req.mode);
  const [place, setPlace] = useState<Placement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const settings = dictSettings.use((s) => s);
  const zh = appSettings.use((s) => s.language) === 'zh';

  // 请求变化（新选区）时复位模式
  useEffect(() => setMode(req.mode), [req]);

  // 卡片内容（加载中 → 释义/译文）会改变高度：用 ResizeObserver 重新定位。位置没变就不 setState，免得死循环
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reposition = () => {
      const anchor = req.rect ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      // DICT-007：选区在屏幕上半部 → 卡片放下面，反之放上面
      const prefer = anchor.top + anchor.height / 2 < window.innerHeight / 2 ? 'below' : 'above';
      const next = placeNear({ left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom }, size, { width: window.innerWidth, height: window.innerHeight }, { prefer });
      setPlace((cur) => (cur && cur.left === next.left && cur.top === next.top && cur.side === next.side ? cur : next));
    };
    reposition();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : undefined;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [req.rect, mode]);

  useFocusAndEscape(ref, closeLookupCard, !!place);

  return (
    <>
      <div className={css.floating} style={{ inset: 0, zIndex: 890 }} onPointerDown={closeLookupCard} />
      <div
        ref={ref}
        className={css.bubble}
        role="dialog"
        aria-label={mode === 'dict' ? td('dictionary') : td('translate')}
        data-testid="lookup-card"
        tabIndex={-1}
        style={{ outline: 'none', width: 'min(92vw, 420px)', left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden', zIndex: 901 }}
      >
        <div className={css.bubbleHead}>
          <span className={css.grow} title={req.text}>
            {req.text}
          </span>
          <IconButton label={td('dictionary')} active={mode === 'dict'} onClick={() => setMode('dict')} style={{ width: 32, height: 32 }}>
            <BookText size={17} />
          </IconButton>
          <IconButton label={td('translate')} active={mode === 'translate'} onClick={() => setMode('translate')} style={{ width: 32, height: 32 }}>
            <Languages size={17} />
          </IconButton>
          <IconButton label={tc('close')} onClick={closeLookupCard} style={{ width: 32, height: 32 }}>
            <X size={17} />
          </IconButton>
        </div>
        {mode === 'dict' ? <DictBody req={req} zh={zh} inlineSource={settings.inlineSource} /> : <TranslateBody req={req} zh={zh} />}
      </div>
    </>
  );
}

function FallbackLinks({ word }: { word: string }) {
  const zh = appSettings.get().language === 'zh';
  const { sourceLanguage, destLanguage } = dictSettings.get();
  return (
    <div className={css.chips}>
      {fallbackSources().map((s) => (
        <button key={s.id} type="button" className={css.chip} onClick={() => openUrl(fillUrl(s.url, { word, lang: zh ? 'zh' : 'en', sl: sourceLanguage, tl: destLanguage }))}>
          <ExternalLink size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

function DictBody({ req, inlineSource }: { req: LookupRequest; zh: boolean; inlineSource: string }) {
  const [state, setState] = useState<DictState>({ status: 'loading' });
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [src, setSrc] = useState(req.sourceId ?? inlineSource);
  const { destLanguage } = dictSettings.get();

  useEffect(() => {
    if (!hasServer()) return;
    apiJson<{ sources: { id: string; name: string }[] }>('/api/dict/sources')
      .then((r) => setSources(r.sources ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    (async () => {
      if (!hasServer()) return setState({ status: 'no-server', reason: 'no-server' });
      if (!(await hasServerFeature('dict'))) return setState({ status: 'no-server', reason: 'no-feature' });
      const qs = new URLSearchParams({ word: req.text, from: req.bookLang ?? 'auto', to: destLanguage });
      if (src) qs.set('source', src);
      try {
        const data = await apiJson<DictResponse>(`/api/dict?${qs}`, { signal: ac.signal });
        setState(data.html ? { status: 'ok', data } : { status: 'empty' });
      } catch (e) {
        if (!ac.signal.aborted) setState({ status: 'error', message: (e as Error).message });
      }
    })();
    return () => ac.abort();
  }, [req.text, req.bookLang, src, destLanguage]);

  const play = (audio: string) => {
    const a = new Audio(serverUrl(audio));
    a.play().catch(() => toast(tc('serverUnavailable')));
  };

  return (
    <div>
      {sources.length > 1 && (
        <div className={css.row2} style={{ marginBottom: 6 }}>
          <span className={css.muted}>{td('source')}</span>
          <Select value={src} options={[{ value: '', label: td('inlineDefault') }, ...sources.map((s) => ({ value: s.id, label: s.name }))]} onChange={setSrc} />
        </div>
      )}
      {state.status === 'loading' && <div className={css.muted}>{td('looking')}</div>}
      {state.status === 'ok' && (
        <>
          {(state.data.phonetic || state.data.audio) && (
            <div className={css.row2} style={{ marginBottom: 4 }}>
              {state.data.phonetic && <span className={css.muted}>{state.data.phonetic}</span>}
              {state.data.audio && (
                <IconButton label={td('playAudio')} onClick={() => play(state.data.audio!)} style={{ width: 30, height: 30 }}>
                  <Volume2 size={16} />
                </IconButton>
              )}
            </div>
          )}
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(state.data.html) }} />
        </>
      )}
      {state.status === 'empty' && (
        <>
          <div className={css.muted}>{td('notFound', { word: req.text })}</div>
          <FallbackLinks word={req.text} />
        </>
      )}
      {state.status === 'no-server' && (
        <>
          <div className={css.muted}>{state.reason === 'no-server' ? td('noServer') : td('serverNoDict')}</div>
          <FallbackLinks word={req.text} />
        </>
      )}
      {state.status === 'error' && (
        <>
          <div className={css.muted}>{td('serverError', { msg: state.message })}</div>
          <FallbackLinks word={req.text} />
        </>
      )}
    </div>
  );
}

function TranslateBody({ req, zh }: { req: LookupRequest; zh: boolean }) {
  const settings = dictSettings.use((s) => s);
  const [state, setState] = useState<TransState>({ status: 'loading' });
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (hasServer()) void listTranslateProviders().then(setProviders);
  }, []);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    void translateText({ text: req.text, from: settings.sourceLanguage, to: settings.destLanguage, provider: settings.translateProvider || undefined }).then((r) => {
      if (!alive) return;
      setState(r.ok ? { status: 'ok', text: r.text, provider: r.provider, detected: r.detectedFrom } : { status: 'fail', reason: r.reason, message: r.message });
    });
    return () => {
      alive = false;
    };
  }, [req.text, settings.sourceLanguage, settings.destLanguage, settings.translateProvider]);

  const langOptions = (withAuto: boolean) =>
    TRANSLATE_LANGS.filter((l) => withAuto || l.code !== 'auto').map((l) => ({ value: l.code, label: zh ? l.zh : l.en }));

  return (
    <div>
      <div className={css.row2} style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <Select value={settings.sourceLanguage} options={langOptions(true)} onChange={(v) => dictSettings.set({ sourceLanguage: v })} />
        <span className={css.muted}>→</span>
        <Select value={settings.destLanguage} options={langOptions(false)} onChange={(v) => dictSettings.set({ destLanguage: v })} />
        {providers.length > 1 && (
          <Select
            value={settings.translateProvider}
            options={[{ value: '', label: td('providerDefault') }, ...providers.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(v) => dictSettings.set({ translateProvider: v })}
          />
        )}
      </div>
      {state.status === 'loading' && <div className={css.muted}>{td('translating')}</div>}
      {state.status === 'ok' && (
        <>
          <div style={{ whiteSpace: 'pre-wrap' }} data-testid="translate-result">
            {state.text}
          </div>
          <div className={css.row2} style={{ marginTop: 8 }}>
            <span className={`${css.muted} ${css.grow}`}>{state.provider}</span>
            <IconButton
              label={td('copyResult')}
              onClick={async () => toast((await copyText(state.text)) ? tc('copied') : tc('copyFailed'))}
              style={{ width: 32, height: 32 }}
            >
              <Copy size={16} />
            </IconButton>
          </div>
        </>
      )}
      {state.status === 'fail' && (
        <>
          <div className={css.muted}>{state.reason === 'no-server' ? td('translateNoServer') : td('serverError', { msg: state.message })}</div>
          <div className={css.chips}>
            <button type="button" className={css.chip} onClick={() => openUrl(translateUrl(req.text, settings.sourceLanguage, settings.destLanguage))}>
              <ExternalLink size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
              {td('openGoogleTranslate')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
