// 启动时的一次性动作：自动打开上次阅读的书（openLastFile）、PWA 文件打开（file_handlers/launchQueue，MISC-008）、
// 链接导入（?open=<url>，LIB-036/NET-008）、后台服务（云同步、Readwise 自动分享）。
import { screenSettings } from '@/reader/settings';
import { getHistory } from '@/storage/db';
import { startReadwiseAutoShare } from '@/storage/readwise';
import { toast } from '@/ui';
import { enqueueDownload } from './downloads';
import { importWithUi } from './ImportDialogs';
import { goRead } from './actions';
import { startSyncService } from './sync-service';
import { consumeSharedFiles, registerServiceWorker } from './pwa';
import { t } from './i18n';

let done = false;

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

export function runStartup(initialRoute: string): void {
  if (done || typeof window === 'undefined') return;
  done = true;
  startSyncService();
  startReadwiseAutoShare((msg) => toast(t('readwiseErr', { msg })));
  // PWA：注册 service worker（仅 http(s) 部署）；接收分享目标（?shared=1）收到的文件
  void registerServiceWorker();
  void consumeSharedFiles();

  // PWA 文件打开：用本应用打开 .epub 等文件
  const lq = (window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
  lq?.setConsumer(async (p) => {
    if (!p.files?.length) return;
    const files = await Promise.all(p.files.map((h) => h.getFile()));
    const res = await importWithUi(files.map((file) => ({ file })));
    const first = res.added[0] ?? res.existing[0];
    if (first) goRead(first.id);
  });

  // ?open=<链接>：交给下载队列（经服务端代理）
  const q = new URLSearchParams(window.location.search);
  const link = q.get('open') ?? q.get('url');
  if (link && /^https?:\/\//i.test(link)) {
    enqueueDownload({ title: '', url: link });
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    return;
  }

  // 自动打开上次阅读的书（只在从首页启动时）
  if (screenSettings.get().openLastFile && (initialRoute === '' || initialRoute === 'recent')) {
    void getHistory().then((h) => {
      if (h[0]) goRead(h[0].bookId);
    });
  }
}
