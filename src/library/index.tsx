// 书架/书库模块对外入口（src/library 负责实现）：除阅读页以外的所有页面，以及供阅读页调用的几个函数。
import type { Route } from '@/core/router';

/** 渲染书架、网络书库、统计、设置等页面（路由名非 'read' 的都交给它） */
export function LibraryApp(props: { route: Route }) {
  return <div style={{ padding: 16 }}>library: {props.route.name || 'home'}</div>;
}

/** 打开书籍信息对话框（阅读页动作 6「显示书籍信息」也调它） */
export function openBookInfo(_bookId: string): void {
  /* 由 library 模块实现 */
}

/** 书架上相邻的书（阅读页动作 2/3「上一文件/下一文件」），按当前书架排序；没有返回 null */
export async function getAdjacentBook(_bookId: string, _dir: 1 | -1): Promise<string | null> {
  return null;
}
