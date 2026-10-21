// 应用外壳：按 hash 路由切页面。#/read/<bookId> 是阅读页，其余路由都交给书库模块。
import { useRoute } from './core/router';
import { appSettings } from './core/app-settings';
import { OverlayHost } from './ui';
import { ReaderPage } from './reader/ui';
import { LibraryApp } from './library';

export function App() {
  const route = useRoute();
  const lang = appSettings.use((s) => s.language);
  return (
    <div className="app-root" key={lang}>
      {route.name === 'read' && route.params[0] ? <ReaderPage key={route.params[0]} bookId={route.params[0]} /> : <LibraryApp route={route} />}
      <OverlayHost />
    </div>
  );
}
