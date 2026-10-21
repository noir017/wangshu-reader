// 应用外壳：按 hash 路由切页面。各页面组件由对应模块提供，这里只做装配。
import { useRoute } from './core/router';
import { appSettings } from './core/app-settings';
import { defineMessages } from './core/i18n';

const t = defineMessages({
  zh: { placeholder: '静读天下 Web：页面「{name}」尚未实现' },
  en: { placeholder: 'Moon+ Reader Web: page "{name}" is not implemented yet' },
});

export function App() {
  const route = useRoute();
  const lang = appSettings.use((s) => s.language);
  return (
    <div className="app-root" key={lang}>
      <p style={{ padding: 16 }}>{t('placeholder', { name: route.name || 'library' })}</p>
    </div>
  );
}
