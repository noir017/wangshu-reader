// 书架/书库模块对外入口（src/library 负责实现）：除阅读页以外的所有页面，以及供阅读页调用的几个函数。
import type { Route } from '@/core/router';
import { LibraryShell } from './Shell';

/** 渲染书架、网络书库、统计、设置等页面（路由名非 'read' 的都交给它） */
export function LibraryApp(props: { route: Route }) {
  return <LibraryShell route={props.route} />;
}

/** 打开书籍信息对话框（阅读页动作 6「显示书籍信息」也调它） */
export { openBookInfo } from './BookInfo';

/** 书架上的相邻书（阅读页动作 2/3「上一文件/下一文件」），按当前书架排序；没有返回 null */
export { getAdjacentBook } from './adjacent';

/** 阅读页底栏第 18/19 号按钮：手动同步到云端 / 从云端同步（SYNC-006） */
export { syncToCloud, syncFromCloud } from './sync-service';
