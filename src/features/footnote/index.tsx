// 脚注弹窗（TOC-004）、链接处理与「链接返回」栈（TOC-005）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerUpLeft, X } from 'lucide-react';
import { currentLang } from '@/core/i18n';
import type { ReaderLocation } from '@/core/reader';
import { useReaderSession, type ReaderSession } from '@/core/reader-session';
import { confirmDialog, IconButton, popupMenu, toast } from '@/ui';
import { useBus, useControllerEvent, useFocusAndEscape, useLongPress } from '../common/hooks';
import { useLinkBack, linkBackTitle, popLinkBack, popLinkBackTo, pushLinkBack } from '../common/linkback';
import { placeNear, type Placement } from '../common/position';
import { sanitizeHtml } from '../common/sanitize';
import { getSectionText } from '../common/section-text';
import css from '../common/features.module.css';
import { classifyHref, openableHref, pickBackLocation } from './links';
import { tf } from './messages';
import { peekLocation } from '../common/safe';

interface FootState {
  html: string;
  rect: DOMRect;
}

function FootnoteBubble({ foot, onClose }: { foot: FootState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlace(placeNear(foot.rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, { prefer: 'below', gap: 10 }));
  }, [foot]);
  useFocusAndEscape(ref, onClose, !!place);
  return createPortal(
    <>
      <div className={css.floating} style={{ inset: 0, zIndex: 889 }} onPointerDown={onClose} />
      <div
        ref={ref}
        className={css.bubble}
        data-testid="footnote-popup"
        tabIndex={-1}
        style={{ outline: 'none', width: 'min(92vw, 420px)', left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden', zIndex: 901 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={css.bubbleHead}>
          <span className={css.grow}>{tf('footnote')}</span>
          <IconButton label={tf('close')} onClick={onClose} style={{ width: 30, height: 30 }}>
            <X size={16} />
          </IconButton>
        </div>
        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(foot.html) }} />
      </div>
    </>,
    document.body,
  );
}

async function backEntryOf(session: ReaderSession, loc: ReaderLocation): Promise<{ locator: ReaderLocation['locator']; title: string }> {
  const text = await getSectionText(session.controller, loc.locator.section).catch(() => '');
  return { locator: loc.locator, title: linkBackTitle(loc.progress, text.slice(loc.locator.offset, loc.locator.offset + 40), currentLang() === 'zh') };
}

function LinkBackButton({ session }: { session: ReaderSession }) {
  const stack = useLinkBack((s) => s.stack);
  const goBack = async () => {
    const e = popLinkBack();
    if (e) await session.controller.goTo(e.locator);
  };
  const lp = useLongPress(() => showHistory());
  const showHistory = () => {
    const { stack } = useLinkBack.getState();
    const items = [...stack].reverse().map((e, i) => ({
      label: e.title,
      onSelect: () => {
        const t = popLinkBackTo(i);
        if (t) void session.controller.goTo(t.locator);
      },
    }));
    popupMenu(16, window.innerHeight - 120 - items.length * 42, items);
  };
  if (!stack.length) return null;
  return createPortal(
    <button
      type="button"
      className={css.floating}
      data-testid="linkback-button"
      aria-label={tf('back')}
      title={`${tf('backTo', { title: stack[stack.length - 1].title })}`}
      style={{
        left: 14,
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        width: 46,
        height: 46,
        borderRadius: '50%',
        border: 'none',
        background: 'var(--mr-bar-bg)',
        color: 'var(--mr-bar-fg)',
        boxShadow: '0 3px 12px rgb(0 0 0 / 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 880,
      }}
      {...lp.bind}
      onPointerDown={(e) => {
        e.stopPropagation();
        lp.bind.onPointerDown();
      }}
      onClick={() => {
        if (lp.consumed()) return;
        void goBack();
      }}
    >
      <CornerUpLeft size={22} />
      {stack.length > 1 && <span style={{ position: 'absolute', top: -2, right: -2, background: 'var(--mr-accent)', color: '#fff', fontSize: 11, borderRadius: 9, padding: '0 5px', minWidth: 18, textAlign: 'center' }}>{stack.length}</span>}
    </button>,
    document.body,
  );
}

/**
 * showBackButton：是否画 features 自己的「返回」悬浮按钮。reader/ui 已经有一套返回按钮与栈，默认不画，
 * 免得页面上出现两个；栈本身照常维护（搜索导航面板的「返回」用它）。
 */
export function LinkHost({ showBackButton = false }: { showBackButton?: boolean }) {
  const session = useReaderSession();
  const { controller } = session;
  const [foot, setFoot] = useState<FootState | null>(null);
  const loc = useRef<{ prev?: ReaderLocation; cur?: ReaderLocation; at: number }>({ cur: peekLocation(controller) ?? undefined, at: 0 });

  useControllerEvent('relocate', (l) => {
    loc.current = { prev: loc.current.cur, cur: l, at: Date.now() };
  });

  const closeFoot = useCallback(() => setFoot(null), []);

  useControllerEvent('link', (e) => {
    if (e.footnoteHtml) {
      setFoot({ html: e.footnoteHtml, rect: e.rect });
      return;
    }
    if (e.internal) {
      const here = pickBackLocation(loc.current.prev, peekLocation(controller) ?? loc.current.cur, loc.current.at, Date.now());
      if (here) void backEntryOf(session, here).then(pushLinkBack);
      return;
    }
    const href = openableHref(e.href);
    if (!href) {
      toast(tf('blocked'));
      return;
    }
    // 外链：确认后新标签打开（TOC-005）
    void confirmDialog(<div style={{ wordBreak: 'break-all' }}>{href}</div>, { title: tf('externalTitle'), okText: tf('externalOpen') }).then((ok) => {
      if (ok) window.open(href, classifyHref(href) === 'web' ? '_blank' : '_self', 'noopener,noreferrer');
    });
  });

  useBus('footnote.open', ({ html, rect }) => setFoot({ html, rect: rect ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0) }));
  // 给 reader/ui 绑定返回键/动作用：弹出栈顶并回到那里
  useBus('linkback.back', () => {
    const e = popLinkBack();
    if (e) void controller.goTo(e.locator);
  });

  return (
    <>
      {foot && <FootnoteBubble foot={foot} onClose={closeFoot} />}
      {showBackButton && <LinkBackButton session={session} />}
    </>
  );
}
