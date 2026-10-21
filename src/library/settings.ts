// 书架/文件页/网络书库/同步等页面的设置（原 app 的 options1002 中与本模块相关的项，spec 01 §3）。
// 账号口令不放这里（设置会随备份导出），放在 kv，见 storage/accounts.ts。
import { defineSettings } from '@/core/settings';

const tablet = Math.min(globalThis.screen?.width ?? 400, globalThis.screen?.height ?? 800) >= 600;

export type ShelfStyle = 0 | 1 | 2; // 列表 / 网格 / 封面流
export type SortBy = 0 | 1 | 2 | 3 | 4; // 书名 / 作者 / 导入时间 / 存储目录 / 最近阅读
export type ShelfCategory = 0 | 1 | 2 | 3 | 4 | 5; // 全部 / 珍藏 / 系列 / 作者 / 标签 / 存储目录

export const DEFAULT_FAV = 'default_fav';

export const shelfSettings = defineSettings('library.shelf', {
  // 视图与分类
  shelfStyle: 1 as ShelfStyle,
  sortBy: 0 as SortBy,
  category: 0 as ShelfCategory,
  /** 当前分组下钻的值（空 = 显示分组列表） */
  subCollection: '',
  /** 从「作者」点进「系列」视图时的作者名 */
  subAuthor: '',
  filterUnread: true,
  filterReading: true,
  filterFinished: true,
  filterAll: true,
  /** filterAll 为 false 时生效：epub / pdf / mobi / fb2 / chm / docx / txt / html / cbz */
  filterTypes: ['epub'] as string[],
  // 外观
  woody: true,
  woodyResDay: 0,
  woodyResNight: 0,
  coverWithProgress: false,
  shelfCoverSize: tablet ? 130 : 110,
  recentCoverSize: 90,
  fileCoverSize: 48,
  netCoverSize: 48,
  shelfFontSize: tablet ? 17 : 16,
  shelfBoldFont: false,
  /** 缺省封面的配色序号 0..5；-1 = 自动（按书名挑色） */
  defaultCover: -1,
  // 框架
  simpleRecentList: false,
  hideFab: false,
  favoriteOnDrawer: false,
  mainNightTheme: false,
  sysDarkModeFollow: false,
  /** 首页「我的珍藏」行显示的收藏夹 */
  recentFavName: DEFAULT_FAV,
  // 导入
  importFileSize: 20,
  importTypes: ['epub', 'pdf', 'fb2', 'mobi', 'chm', 'docx', 'html', 'txt', 'cbz'] as string[],
  scanFav: '',
  fileImportWithFav: true,
  // 封面
  coverSearchEngine: 'openlibrary' as 'openlibrary' | 'googlebooks',
  // 启动保护（弱保护：只遮挡界面，数据仍在 IndexedDB）
  lockEnabled: false,
  lockSalt: '',
  lockHash: '',
});

export const filesSettings = defineSettings('library.files', {
  sortBy: 0, // 0..5：名称/大小/时间 升降
  useGrid: false,
  showHidden: false,
  lastPath: '',
  /** 文件夹快速访问列表（服务端目录，相对书库根） */
  favFolders: [] as string[],
  showDavInFavorites: true,
});

export const netSettings = defineSettings('library.net', {
  useGrid: false,
  lastCatalogUrl: 'http://',
});

export type SyncMode = 'builtin' | 'custom';

export const syncSettings = defineSettings('library.sync', {
  /** 总开关（原 syncType=6）；Dropbox/Google Drive 只做配置占位 */
  enabled: false,
  mode: 'builtin' as SyncMode,
  /** custom 模式的 WebDAV 地址 */
  url: 'https://',
  user: '',
  showSyncMsg: true,
  syncManually: false,
  syncReadingBook: false,
  syncRecentList: false,
  /** 书籍根路径，.Moon+ 放在其下 */
  bookPath: '/Apps/Books',
  /** Dropbox / Google Drive 需要自己的 OAuth 应用（占位） */
  dropboxAppKey: '',
  gdriveClientId: '',
});

export const readwiseSettings = defineSettings('library.readwise', {
  token: '',
  url: 'https://readwise.io/api/v2/highlights/',
  /** 自动分享新的高亮和标注 */
  auto: false,
  withChapter: true,
});
