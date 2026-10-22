// 速读（RSVP）界面（AUTO-004，PrefSpeedRead）：全屏深色，中央逐词闪现；点中央 = 开始/暂停，暂停时两侧 < > 逐词前后移；
// 点其它区域显示/隐藏底部控制条（速度、字号、每次词数）；退出时把阅读位置推进到速读到达处，并记入阅读时长/字数。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { autoScrollSettings } from '@/reader/settings';
import { addReadingTime } from '@/storage/db';
import { Slider, toast } from '@/ui';
import { useReaderUi } from '../store';
import { countWords } from '../services/reading-time';
import { chunkDelay, chunkTokens, tokenize, type Token } from './tokenize';
import { t } from '../messages';
import s from '../reader-ui.module.css';

const MAX_CHARS = 500_000;

export function SpeedRead() {
  const session = useReaderUi((x) => x.session);
  const wpm = autoScrollSettings.use((a) => a.speedReadWPM);
  const size = autoScrollSettings.use((a) => a.speedReadSize);
  const perChunk = autoScrollSettings.use((a) => a.speedReadWords);
  const [section, setSection] = useState(0);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [controls, setControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const startedAt = useRef(Date.now());
  const readTokens = useRef(0);
  const startOffset = useRef(0);
  /** 一屏大约多少词：速读时按它把读过的词数折算成页数，计入统计卡片的页数 */
  const wordsPerPage = useRef(0);

  const chunks = useMemo(() => chunkTokens(tokens, perChunk), [tokens, perChunk]);
  const chunkIdx = Math.min(chunks.length - 1, Math.floor(idx / Math.max(1, perChunk)));
  const cur = chunks[chunkIdx];

  const loadSection = useCallback(
    async (sec: number, from: number): Promise<boolean> => {
      if (!session) return false;
      const text = (await session.controller.getSectionText(sec)).slice(from, from + MAX_CHARS);
      const tk = tokenize(text, session.book.metadata.language).map((x) => ({ ...x, start: x.start + from }));
      if (tk.length === 0) return false;
      setSection(sec);
      setTokens(tk);
      setIdx(0);
      return true;
    },
    [session],
  );

  // 从当前位置起取词
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const loc = session.controller.getLocation();
    const sec = loc?.section ?? 0;
    startOffset.current = loc?.locator.offset ?? 0;
    startedAt.current = Date.now();
    if (loc) {
      const v = loc.visible;
      void session.controller.getSectionText(v.section).then((text) => (wordsPerPage.current = countWords(text.slice(v.start, v.end))));
    }
    void loadSection(sec, startOffset.current).then((ok) => {
      if (!alive) return;
      setLoading(false);
      if (!ok) toast(t('speedread_empty'));
    });
    return () => {
      alive = false;
    };
  }, [session, loadSection]);

  // 播放：按每块的节奏推进；到末尾自动进入下一章（可重排书），否则停止
  useEffect(() => {
    if (!playing || !cur || !session) return;
    const id = setTimeout(async () => {
      const next = chunkIdx + 1;
      readTokens.current += cur.words;
      if (next < chunks.length) {
        setIdx(chunks[next].index);
        return;
      }
      const book = session.book;
      const last = book.kind === 'fixed' ? book.pageCount - 1 : book.sections.length - 1;
      if (section < last && (await loadSection(section + 1, 0))) return;
      setPlaying(false);
      toast(t('speedread_done'));
    }, chunkDelay(cur, wpm));
    return () => clearTimeout(id);
  }, [playing, cur, chunkIdx, chunks, wpm, section, session, loadSection]);

  const close = useCallback(() => {
    const ui = useReaderUi.getState();
    ui.setSpeedRead(false);
    if (!session) return;
    // 把阅读位置推进到速读到达的位置，并累计阅读时长与字数
    if (cur) void session.controller.goTo({ section, offset: cur.start });
    const words = readTokens.current;
    const ms = Date.now() - startedAt.current;
    const pages = wordsPerPage.current > 0 ? Math.floor(words / wordsPerPage.current) : 0;
    void addReadingTime(session.bookId, ms, words, Date.now(), pages);
  }, [cur, section, session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight' && !playing) setIdx((i) => Math.min(tokens.length - 1, i + perChunk));
      else if (e.key === 'ArrowLeft' && !playing) setIdx((i) => Math.max(0, i - perChunk));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, playing, tokens.length, perChunk]);

  return (
    <div className={s.speedRoot} role="dialog" aria-label={t('speed_read')}>
      <div className={s.speedProgress}>
        {tokens.length ? `${Math.min(idx + 1, tokens.length)}/${tokens.length}` : ''}
      </div>
      <button type="button" className={`${s.barBtn} ${s.speedClose}`} aria-label={t('close')} onClick={close}>
        <X size={22} />
      </button>
      <div className={s.speedWord} onClick={() => setControls((v) => !v)}>
        {!playing && (
          <>
            <div className={s.speedSide} style={{ left: 0 }} onClick={(e) => (e.stopPropagation(), setIdx((i) => Math.max(0, i - perChunk)))}>
              &lt;
            </div>
            <div className={s.speedSide} style={{ right: 0 }} onClick={(e) => (e.stopPropagation(), setIdx((i) => Math.min(tokens.length - 1, i + perChunk)))}>
              &gt;
            </div>
          </>
        )}
        <div
          style={{ fontSize: size, lineHeight: 1.3, padding: '24px 12px', cursor: 'pointer', maxWidth: '70%', wordBreak: 'keep-all' }}
          onClick={(e) => (e.stopPropagation(), cur && setPlaying((p) => !p))}
        >
          {loading ? t('loading') : cur ? cur.text : playing ? '' : t('start')}
          {!playing && cur && idx === 0 && !readTokens.current ? <div style={{ fontSize: 14, opacity: 0.6, marginTop: 8 }}>{t('start')}</div> : null}
        </div>
      </div>
      {controls && (
        <div className={s.speedControls}>
          <Slider label={t('read_speed')} value={wpm} min={50} max={2000} step={10} onChange={(v) => autoScrollSettings.set({ speedReadWPM: v })} />
          <Slider label={t('font_size')} value={size} min={10} max={100} onChange={(v) => autoScrollSettings.set({ speedReadSize: v })} />
          <Slider label={t('screen_words')} value={perChunk} min={1} max={10} onChange={(v) => autoScrollSettings.set({ speedReadWords: v })} />
        </div>
      )}
    </div>
  );
}
