// 书架过滤/排序/视图对话框（LIB-007/008/009）
import { LayoutGrid, List, GalleryHorizontal, Settings } from 'lucide-react';
import { Segmented, Sheet, openOverlay, IconButton } from '@/ui';
import { CheckBox } from './ui-kit';
import { shelfSettings, type ShelfStyle, type SortBy } from './settings';
import { TYPE_GROUPS } from './shelf-model';
import { navigate } from '@/core/router';
import { t } from './i18n';
import s from './library.module.css';

export function openShelfFilter(): void {
  openOverlay((close) => <ShelfFilter onClose={close} />);
}

function ShelfFilter({ onClose }: { onClose: () => void }) {
  const v = shelfSettings.use((st) => st);
  const toggleType = (key: string, on: boolean) => {
    const types = new Set(v.filterTypes);
    if (on) types.add(key);
    else types.delete(key);
    shelfSettings.set({ filterTypes: [...types], filterAll: false });
  };
  const close = () => {
    // 三个状态全没勾时自动恢复全选（PSF.dismiss）
    const c = shelfSettings.get();
    if (!c.filterUnread && !c.filterReading && !c.filterFinished) shelfSettings.set({ filterUnread: true, filterReading: true, filterFinished: true });
    if (!c.filterAll && c.filterTypes.length === 0) shelfSettings.set({ filterAll: true });
    onClose();
  };
  const sorts: { value: SortBy; label: string }[] = [
    { value: 0, label: t('sortTitle') },
    { value: 1, label: t('sortAuthor') },
    { value: 2, label: t('sortAdded') },
    { value: 3, label: t('sortDir') },
    { value: 4, label: t('sortRecent') },
  ];
  return (
    <Sheet
      open
      position="center"
      title={t('filterTitle')}
      onClose={close}
      headerRight={
        <IconButton
          label={t('options')}
          onClick={() => {
            close();
            // 带分区是次级页：返回键回书架，而不是像抽屉里切顶级页那样回首页
            navigate('settings', 'shelf');
          }}
        >
          <Settings size={20} />
        </IconButton>
      }
    >
      <div className={s.pad} style={{ display: 'flex', justifyContent: 'center' }}>
        <Segmented<ShelfStyle>
          value={v.shelfStyle}
          onChange={(x) => shelfSettings.set({ shelfStyle: x })}
          options={[
            { value: 0, label: <List size={18} aria-label={t('shelfStyleList')} /> },
            { value: 1, label: <LayoutGrid size={18} aria-label={t('shelfStyleGrid')} /> },
            { value: 2, label: <GalleryHorizontal size={18} aria-label={t('shelfStyleFlow')} /> },
          ]}
        />
      </div>
      <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('sort')}</div>
      {sorts.map((o) => (
        <label key={o.value} className={s.check}>
          <input type="radio" name="sort" checked={v.sortBy === o.value} onChange={() => shelfSettings.set({ sortBy: o.value })} style={{ width: 18, height: 18, accentColor: 'var(--mr-accent)' }} />
          <span>{o.label}</span>
        </label>
      ))}
      <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('readFilter')}</div>
      <CheckBox checked={v.filterUnread} onChange={(x) => shelfSettings.set({ filterUnread: x })} label={t('readUnread')} />
      <CheckBox checked={v.filterReading} onChange={(x) => shelfSettings.set({ filterReading: x })} label={t('readReading')} />
      <CheckBox checked={v.filterFinished} onChange={(x) => shelfSettings.set({ filterFinished: x })} label={t('readFinished')} />
      <div className={`${s.fieldLabel} ${s.pad}`} style={{ paddingBottom: 0 }}>{t('fileType')}</div>
      <CheckBox checked={v.filterAll} onChange={(x) => shelfSettings.set({ filterAll: x })} label={t('fileTypeAll')} />
      {!v.filterAll &&
        Object.entries(TYPE_GROUPS).map(([key, g]) => <CheckBox key={key} checked={v.filterTypes.includes(key)} onChange={(x) => toggleType(key, x)} label={g.label} />)}
    </Sheet>
  );
}
