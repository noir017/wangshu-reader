// 看图器（COMIC-004，TOC-006）：缩放（双击 1→1.75→3→1、双指、滚轮）、平移、左右切图、缩略图条、保存/分享、幻灯片。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Moon, Pause, Play, Settings2, Share2, Sun, X } from 'lucide-react';
import { useReaderSession, type ReaderSession } from '@/core/reader-session';
import { Button, IconButton, openOverlay, Row, Select, Sheet, Switch, toast } from '@/ui';
import { downloadBlob, shareFile } from '../common/clipboard';
import { tc } from '../common/messages';
import { getSectionDoc } from '../common/section-docs';
import { scanBookImages } from '../toc/images';
import { ti } from './messages';
import { gallerySettings } from './settings';
import { clampView, fitSize, nextZoomStep, swipeAction, tapZone, zoomAround, ZOOM_MAX, ZOOM_MIN, type View } from './zoom-math';
import css from './viewer.module.css';
import { peekLocation } from '../common/safe';

export interface ViewerImage {
  src: string;
  alt?: string;
}

/** 当前章已渲染出来的图片（引擎 sectionReady 的文档里取） */
export function imagesInSection(section: number): ViewerImage[] {
  const doc = getSectionDoc(section);
  if (!doc) return [];
  return [...doc.querySelectorAll('img')].map((el) => ({ src: el.currentSrc || el.src, alt: el.alt || undefined })).filter((i) => i.src);
}

function extOf(blob: Blob, src: string): string {
  const m = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:$|[?#])/i.exec(src);
  if (m) return m[1].toLowerCase();
  const t = blob.type.split('/')[1];
  return t ? t.replace('jpeg', 'jpg').replace('svg+xml', 'svg') : 'png';
}

async function fetchBlob(src: string): Promise<Blob> {
  const r = await fetch(src);
  return r.blob();
}

function OptionsDialog({ close }: { close: () => void }) {
  const s = gallerySettings.use((x) => x);
  return (
    <Sheet open position="center" title={ti('options')} onClose={close} actions={<Button primary onClick={close}>{tc('ok')}</Button>}>
      <Row title={ti('interval')} right={<Select value={s.slideshowInterval} options={[1, 2, 3, 5, 8, 10, 15, 30].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => gallerySettings.set({ slideshowInterval: v })} />} />
      <Row title={ti('showStrip')} onClick={() => gallerySettings.set({ showStrip: !s.showStrip })} right={<Switch checked={s.showStrip} onChange={(v) => gallerySettings.set({ showStrip: v })} />} />
      <Row title={ti('keepAwake')} onClick={() => gallerySettings.set({ keepAwake: !s.keepAwake })} right={<Switch checked={s.keepAwake} onChange={(v) => gallerySettings.set({ keepAwake: v })} />} />
    </Sheet>
  );
}

export function ImageViewer({ session, src, onClose }: { session: ReaderSession; src: string; onClose: () => void }) {
  const loc = peekLocation(session.controller);
  const [list, setList] = useState<ViewerImage[]>(() => {
    const inSec = loc ? imagesInSection(loc.locator.section) : [];
    return inSec.some((i) => i.src === src) ? inSec : [{ src }];
  });
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((i) => i.src === src)));
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [bars, setBars] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [broken, setBroken] = useState(false);
  const s = gallerySettings.use((x) => x);
  const stage = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 点正文图片打开时焦点还在章节 iframe 里：把焦点拿过来，方向键/Esc 才到得了这里
  useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);
  const viewRef = useRef(view);
  viewRef.current = view;
  const cur = list[index] ?? { src };

  // 后台扫描整本书的图片，找得到当前图就换成完整列表
  useEffect(() => {
    let alive = true;
    void scanBookImages(session.book).then((all) => {
      if (!alive || !all.length) return;
      const full = all.map((i) => ({ src: i.src }));
      const at = full.findIndex((i) => i.src === src);
      if (at >= 0 && full.length > 1) {
        setList(full);
        setIndex(at);
      }
    });
    return () => {
      alive = false;
    };
  }, [session.book, src]);

  const viewport = useCallback(() => {
    const r = stage.current?.getBoundingClientRect();
    return { w: r?.width ?? window.innerWidth, h: r?.height ?? window.innerHeight };
  }, []);
  const fit = useMemo(() => fitSize(natural, viewport()), [natural, viewport]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(list.length - 1, i + delta)));
      setView({ scale: 1, tx: 0, ty: 0 });
      setNatural({ w: 0, h: 0 });
      setBroken(false);
    },
    [list.length],
  );

  // 幻灯片：到末尾后停止
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= list.length - 1) {
          setPlaying(false);
          return i;
        }
        setView({ scale: 1, tx: 0, ty: 0 });
        setBroken(false);
        return i + 1;
      });
    }, Math.max(1, s.slideshowInterval) * 1000);
    return () => clearInterval(t);
  }, [playing, list.length, s.slideshowInterval]);

  // 常亮
  useEffect(() => {
    if (!s.keepAwake) return;
    let lock: { release(): Promise<void> } | undefined;
    (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [s.keepAwake]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === '+' || e.key === '=') setView((v) => zoomAround(v, v.scale * 1.25, 0, 0, fit, viewport()));
      else if (e.key === '-') setView((v) => zoomAround(v, v.scale / 1.25, 0, 0, fit, viewport()));
      else if (e.key === '0') setView({ scale: 1, tx: 0, ty: 0 });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose, fit, viewport]);

  // ── 指针：单指拖动平移/滑动翻图，双指缩放，双击循环，单击分区 ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch?: { d: number; scale: number }; startView: View } | null>(null);
  const lastTapAt = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const centerOf = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2, w: r.width };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = (gesture.current ??= { startX: e.clientX, startY: e.clientY, moved: false, startView: viewRef.current });
    if (pointers.current.size === 1) {
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.moved = false;
      g.startView = viewRef.current;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: viewRef.current.scale };
      g.moved = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!p || !g) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = centerOf({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      setView((v) => zoomAround(v, (g.pinch!.scale * d) / g.pinch!.d, mid.x, mid.y, fit, viewport()));
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
    if (g.moved && g.startView.scale > ZOOM_MIN + 0.01) setView(clampView({ scale: g.startView.scale, tx: g.startView.tx + dx, ty: g.startView.ty + dy }, fit, viewport()));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!g) return;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.pinch) return;
    if (!g.moved) {
      const c = centerOf(e);
      const now = Date.now();
      if (now - lastTapAt.current < 300) {
        // 双击：1 → 1.75 → 3 → 1
        clearTimeout(tapTimer.current);
        lastTapAt.current = 0;
        const next = nextZoomStep(viewRef.current.scale);
        setView(next === ZOOM_MIN ? { scale: 1, tx: 0, ty: 0 } : zoomAround(viewRef.current, next, c.x, c.y, fit, viewport()));
        return;
      }
      // 单击：等 300ms 确认不是双击，再按落点分区处理
      lastTapAt.current = now;
      tapTimer.current = setTimeout(() => {
        lastTapAt.current = 0;
        const z = tapZone(c.x + c.w / 2, c.w);
        if (z === 'prev') go(-1);
        else if (z === 'next') go(1);
        else setBars((b) => !b);
      }, 300);
      return;
    }
    const act = swipeAction(dx, dy, viewRef.current.scale);
    if (act === 'prev') go(-1);
    else if (act === 'next') go(1);
  };

  const onWheel = (e: React.WheelEvent) => {
    const c = centerOf(e);
    setView((v) => zoomAround(v, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), c.x, c.y, fit, viewport(), ZOOM_MIN, ZOOM_MAX));
  };

  const save = async () => {
    try {
      const blob = await fetchBlob(cur.src);
      downloadBlob(`${(cur.alt || `image-${index + 1}`).replace(/[\\/:*?"<>|]+/g, '_')}.${extOf(blob, cur.src)}`, blob);
      toast(ti('saved'));
    } catch {
      toast(ti('saveFailed'));
    }
  };
  const share = async () => {
    try {
      const blob = await fetchBlob(cur.src);
      const ok = await shareFile(new File([blob], `image-${index + 1}.${extOf(blob, cur.src)}`, { type: blob.type || 'image/png' }), session.record.title);
      if (!ok) await save();
    } catch {
      toast(ti('saveFailed'));
    }
  };

  const bg = s.whiteBackground ? '#ffffff' : '#000000';
  const fg = s.whiteBackground ? '#222' : '#eee';

  return createPortal(
    <div ref={rootRef} tabIndex={-1} className={css.root} style={{ background: bg, color: fg, outline: 'none' }} data-testid="image-viewer" role="dialog" aria-modal="true">
      <div
        ref={stage}
        className={css.stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {broken ? (
          <div className={css.broken}>{ti('broken')}</div>
        ) : (
          <img
            key={cur.src}
            className={css.img}
            data-testid="viewer-img"
            data-scale={view.scale.toFixed(2)}
            src={cur.src}
            alt={cur.alt ?? ''}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setBroken(true)}
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transition: gesture.current ? 'none' : 'transform 0.2s' }}
          />
        )}
      </div>
      {bars && (
        <div className={css.top} style={{ color: fg, background: s.whiteBackground ? 'linear-gradient(#fffd, #fff0)' : 'linear-gradient(#000d, #0000)' }}>
          <IconButton label={ti('close')} onClick={onClose} style={{ color: fg }}>
            <X size={22} />
          </IconButton>
          <div className={css.titleText} data-testid="viewer-title">
            {ti('title', { n: index + 1, total: list.length })}
          </div>
          <IconButton label={ti('save')} onClick={save} style={{ color: fg }}>
            <Download size={20} />
          </IconButton>
          <IconButton label={ti('share')} onClick={share} style={{ color: fg }}>
            <Share2 size={20} />
          </IconButton>
          <IconButton label={ti('daynight')} onClick={() => gallerySettings.set({ whiteBackground: !s.whiteBackground })} style={{ color: fg }}>
            {s.whiteBackground ? <Moon size={20} /> : <Sun size={20} />}
          </IconButton>
          {list.length > 1 && (
            <IconButton label={playing ? ti('pause') : ti('play')} onClick={() => setPlaying((p) => !p)} style={{ color: fg }}>
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </IconButton>
          )}
          <IconButton label={ti('options')} onClick={() => openOverlay((close) => <OptionsDialog close={close} />)} style={{ color: fg }}>
            <Settings2 size={20} />
          </IconButton>
        </div>
      )}
      {bars && s.showStrip && list.length > 1 && (
        <div className={css.strip} data-testid="viewer-strip">
          {list.map((im, i) => (
            <button
              key={i}
              type="button"
              className={css.stripItem}
              data-active={i === index ? 'true' : undefined}
              onClick={() => {
                setIndex(i);
                setView({ scale: 1, tx: 0, ty: 0 });
                setBroken(false);
              }}
            >
              <img src={im.src} alt="" loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** 宿主：监听 image 事件与 image.open 命令 */
export function ImageViewerHost() {
  const session = useReaderSession();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const off1 = session.controller.on('image', ({ src }) => setSrc(src));
    const off2 = session.bus.on('image.open', ({ src }) => setSrc(src));
    return () => {
      off1();
      off2();
    };
  }, [session]);
  if (!src) return null;
  return <ImageViewer key={src} session={session} src={src} onClose={() => setSrc(null)} />;
}

