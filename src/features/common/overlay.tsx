// openOverlay 渲染在应用根部（会话上下文之外）。需要 useReaderSession 的弹层用它包一层 Provider。
import type { ReactNode } from 'react';
import { ReaderSessionContext, type ReaderSession } from '@/core/reader-session';
import { openOverlay } from '@/ui';

export function openSessionOverlay(session: ReaderSession, render: (close: () => void) => ReactNode): () => void {
  return openOverlay((close) => <ReaderSessionContext.Provider value={session}>{render(close)}</ReaderSessionContext.Provider>);
}
