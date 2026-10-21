// 开发入口：只挂阅读页（#/read/<id>）和浮层容器，不加载书架。用 dev.html 打开。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoute } from '@/core/router';
import { OverlayHost } from '@/ui';
import { ReaderPage } from '../index';
import '@/styles/global.css';

function Dev() {
  const route = useRoute();
  const id = route.name === 'read' ? route.params[0] : undefined;
  return (
    <div className="app-root">
      {id ? <ReaderPage key={id} bookId={id} /> : <div style={{ padding: 24 }}>dev: 打开 #/read/&lt;bookId&gt;（mock-reflow / mock-fixed 需要 ?mrdev=1）。当前路由：{route.name || '/'}</div>}
      <OverlayHost />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dev />
  </StrictMode>,
);
