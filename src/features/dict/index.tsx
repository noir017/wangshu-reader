// 查词/翻译宿主：渲染内联卡片，监听 dict.lookup / translate.open 命令（DICT-001/004）。
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useReaderSession } from '@/core/reader-session';
import { useBus } from '../common/hooks';
import { LookupCard } from './LookupCard';
import { closeLookupCard, lookupWord, translateSelection, useLookupCard } from './lookup';

export function LookupHost() {
  const session = useReaderSession();
  const req = useLookupCard((s) => s.req);

  useBus('dict.lookup', ({ text, range }) => lookupWord(session, text, { range }));
  useBus('translate.open', ({ text }) => translateSelection(session, text));
  // 换书/离开阅读页时关掉残留的卡片
  useEffect(() => () => closeLookupCard(), [session]);

  return req ? createPortal(<LookupCard req={req} />, document.body) : null;
}
