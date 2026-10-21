// 阅读统计页：8 张卡片 + 单书统计（STAT-003/004/005）
import { MoreVertical } from 'lucide-react';
import { IconButton, popupMenu } from '@/ui';
import { navigate } from '@/core/router';
import { TopBar } from './TopBar';
import { StatCardsGrid, confirmClearStats, useStatCards } from './DashPage';
import { useStatsMap } from './RecentPage';
import { useLibrary } from './data';
import { bookSpeed, dateRange } from './stats';
import { openBookInfo } from './BookInfo';
import { Empty } from './ui-kit';
import { formatHours } from './format';
import { t } from './i18n';
import s from './library.module.css';

export function StatsPage() {
  const lib = useLibrary();
  const cards = useStatCards();
  const stats = useStatsMap();
  const rows = [...stats.values()].filter((x) => x.usedMs > 0).sort((a, b) => b.usedMs - a.usedMs);
  return (
    <>
      <TopBar
        title={t('dashStats')}
        actions={
          <IconButton label={t('more')} onClick={(e) => popupMenu(e.clientX - 180, e.clientY, [{ label: t('clearAllStats'), onSelect: () => void confirmClearStats() }])}>
            <MoreVertical size={21} />
          </IconButton>
        }
      />
      <div className={s.content}>
        <div style={{ height: 8 }} />
        <StatCardsGrid cards={cards} onBooks={() => navigate('shelf')} onRead={() => navigate('recent')} />
        <div className={s.sectionHead}>
          <h3>{t('perBookStats')}</h3>
        </div>
        {rows.length === 0 ? (
          <Empty text={t('statsEmpty')} />
        ) : (
          rows.map((r) => {
            const b = lib.byId.get(r.bookId);
            return (
              <div key={r.bookId} className={s.groupRow} style={{ minHeight: 64 }} onClick={() => b && openBookInfo(b.id)}>
                <div className={s.grow}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b?.title ?? '(已删除的书)'}</div>
                  <div className={s.dim} style={{ fontSize: 12 }}>
                    {dateRange(r)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12.5 }}>
                  <div>
                    {formatHours(r.usedMs)} {t('hoursUnit')}
                  </div>
                  <div className={s.dim}>
                    {bookSpeed(r)} {t('wpmUnit')}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div style={{ height: 90 }} />
      </div>
    </>
  );
}
