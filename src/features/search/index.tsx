// 书内搜索入口：命令 search.open → 对话框；有关键词时直接开搜；搜索导航面板与全文高亮。
import { useEffect } from 'react';
import { useReaderSession } from '@/core/reader-session';
import { useBus } from '../common/hooks';
import { SearchDialog, SearchNavPanel } from './SearchUi';
import { clearSearchHighlight, openSearchDialog, startSearch, cancelSearch } from './run';

export function SearchHost() {
  const session = useReaderSession();

  useBus('search.open', ({ query }) => {
    session.bus.emit('menu.hide', {});
    openSearchDialog(query);
    if (query?.trim()) void startSearch(session, query);
  });

  useEffect(
    () => () => {
      cancelSearch();
      clearSearchHighlight(session);
    },
    [session],
  );

  return (
    <>
      <SearchDialog session={session} />
      <SearchNavPanel />
    </>
  );
}
