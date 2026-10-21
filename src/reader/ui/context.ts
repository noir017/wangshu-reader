// 阅读页内共享的 React 上下文：动作宿主（工具按钮、状态栏点击都要用）。
import { createContext, useContext } from 'react';
import type { ActionHost } from './actions/actions';

export const HostContext = createContext<ActionHost | null>(null);

export function useHost(): ActionHost {
  const h = useContext(HostContext);
  if (!h) throw new Error('useHost 必须在 ReaderPage 内使用');
  return h;
}
