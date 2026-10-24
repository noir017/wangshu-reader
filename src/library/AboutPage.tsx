// 软件说明（LIB-038）
import { BookOpen, Cloud, Highlighter, Languages, Library, Volume2 } from 'lucide-react';
import { TopBar } from './TopBar';
import { t } from './i18n';
import s from './library.module.css';

const VERSION = '0.1.1';

export function AboutPage() {
  const features = [
    [<BookOpen key="1" size={18} />, 'EPUB / PDF / MOBI / AZW3 / FB2 / TXT / HTML / DOCX / CHM / UMD / CBZ …'],
    [<Library key="2" size={18} />, '书架：分类、系列、标签、收藏夹、封面、导入与备份'],
    [<Highlighter key="3" size={18} />, '标注：高亮、下划线、笔记、书签，可导出与分享'],
    [<Cloud key="4" size={18} />, '云同步：WebDAV（与手机版 .po / .an 互通）、Readwise'],
    [<Volume2 key="5" size={18} />, '朗读、词典、翻译'],
    [<Languages key="6" size={18} />, '中文 / English'],
  ] as const;
  return (
    <>
      <TopBar title={t('aboutTitle')} />
      <div className={s.content}>
        <div className={s.empty} style={{ paddingBottom: 8 }}>
          <div style={{ width: 76, height: 76, borderRadius: 18, background: 'var(--mr-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgb(0 0 0 / 0.3)' }}>
            <BookOpen size={42} />
          </div>
          <b style={{ fontSize: 20, color: 'var(--mr-fg)' }}>{t('appTitle')}</b>
          <span>
            {t('aboutVersion')} {VERSION}
          </span>
        </div>
        <div className={s.pad} style={{ lineHeight: 1.7 }}>{t('aboutBody')}</div>
        <div className={s.card}>
          <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('aboutFeatures')}</div>
          {features.map(([icon, text], i) => (
            <div key={i} className={s.check} style={{ cursor: 'default', alignItems: 'flex-start', fontSize: 14 }}>
              <span style={{ color: 'var(--mr-accent)', marginTop: 2 }}>{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
