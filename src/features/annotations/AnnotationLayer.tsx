// 标注同步层：装载标注 → 校验/重定位 → setDecorations('annotations')；点击装饰弹出标注气泡。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReaderSession } from '@/core/reader-session';
import { useControllerEvent } from '../common/hooks';
import { getSectionText, peekSectionText, primeSectionText, sectionCount } from '../common/section-text';
import { HLALL_PREFIX, hlAllDecorations, loadHlAll, useHlAll } from './highlight-all';
import { annotationIdOfDecoration, relocate, toDecorations } from './model';
import { startAnnotationSync, useAnnotations } from './store';
import { openAnnotationPopup } from './AnnotationPopup';
import { rememberSectionDoc } from '../common/section-docs';

export function AnnotationLayer() {
  const session = useReaderSession();
  const { controller, bookId } = session;
  const items = useAnnotations((s) => s.items);
  const hlAll = useHlAll((s) => s.items);
  // 重定位结果：id → 新区间；null = 找不到（孤儿）。只放内存，不回写数据库（多端同步时避免互相覆盖）
  const overrides = useRef(new Map<string, { start: number; end: number } | null>());
  const [version, setVersion] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    overrides.current.clear();
    const stop = startAnnotationSync(bookId);
    void loadHlAll(bookId);
    return () => {
      stop();
      controller.setDecorations('annotations', []);
    };
  }, [bookId, controller]);

  const verify = useCallback(
    (section: number, text: string) => {
      let changed = false;
      for (const a of itemsRef.current) {
        if (a.kind !== 'highlight' || a.range.section !== section) continue;
        const r = relocate(text, a);
        const prev = overrides.current.get(a.id);
        const next = r === null ? null : r.moved ? { start: r.start, end: r.end } : undefined;
        const same = prev === next || (prev && next && prev.start === next.start && prev.end === next.end);
        if (same) continue;
        if (next === undefined) overrides.current.delete(a.id);
        else overrides.current.set(a.id, next);
        changed = true;
      }
      if (changed) setVersion((v) => v + 1);
    },
    [],
  );

  const verifySection = useCallback(
    async (section: number) => {
      if (!itemsRef.current.some((a) => a.range.section === section && a.kind === 'highlight') && !useHlAll.getState().items.length) return;
      try {
        verify(section, await getSectionText(controller, section));
        // 全书同词高亮需要该章文本；文本到手后刷新一次装饰
        if (useHlAll.getState().items.length) setVersion((v) => v + 1);
      } catch {
        /* 章节加载失败：保持存储偏移 */
      }
    },
    [controller, verify],
  );

  useControllerEvent('sectionReady', ({ section, doc }) => {
    rememberSectionDoc(section, doc);
    verify(section, primeSectionText(controller, section, doc));
    if (useHlAll.getState().items.length) setVersion((v) => v + 1);
  });
  useControllerEvent('relocate', (loc) => void verifySection(loc.section));

  // 标注列表变化后，先校验当前章（引擎早于本组件挂载时错过的 sectionReady 在这里补上）
  useEffect(() => {
    const loc = controller.getLocation();
    if (loc) void verifySection(loc.section);
  }, [items, controller, verifySection]);

  useEffect(() => {
    const base = toDecorations(items, overrides.current);
    const extra = [];
    if (hlAll.length) {
      for (let s = 0; s < sectionCount(controller); s++) {
        const t = peekSectionText(controller, s);
        if (t) extra.push(...hlAllDecorations(s, t, hlAll));
      }
    }
    controller.setDecorations('annotations', [...extra, ...base]);
  }, [items, hlAll, version, controller]);

  useControllerEvent('decorationClick', ({ layer, id, rect }) => {
    if (layer !== 'annotations' || id.startsWith(HLALL_PREFIX)) return;
    openAnnotationPopup(session, annotationIdOfDecoration(id), rect);
  });

  return null;
}
