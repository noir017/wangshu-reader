// 目录面板宿主：监听 toc.open / bookmarks.open / bookmark.add 命令（TOC-001、ANNO-007）。
import { useCallback, useState } from 'react';
import { useReaderSession } from '@/core/reader-session';
import { toggleBookmark } from '../annotations/BookmarkFlow';
import { useBus } from '../common/hooks';
import { TocPanel, type TocOpenRequest } from './TocPanel';
import { tocRequestOf } from './toc-utils';

export function TocHost() {
  const session = useReaderSession();
  const [req, setReq] = useState<TocOpenRequest | null>(null);

  const open = useCallback(
    (r: TocOpenRequest) => {
      session.bus.emit('menu.hide', {});
      // 每次打开都是新对象，面板据此重置标签
      setReq({ ...r });
    },
    [session],
  );

  useBus('toc.open', ({ tab }) => open(tocRequestOf(tab)));
  useBus('bookmarks.open', () => open({ tab: 'bookmarks' }));
  // 当前页已有书签则删除，否则新建（原 createBookmark 的切换语义）
  useBus('bookmark.add', ({ at }) => void toggleBookmark(session, { at }));

  if (!req) return null;
  return <TocPanel req={req} onClose={() => setReq(null)} />;
}
