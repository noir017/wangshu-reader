// 页面顶栏：菜单/返回、标题（可点）、搜索框与联想、右侧动作。多选态下变成上下文工具栏（LIB-011）。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Menu, Search, X } from 'lucide-react';
import { IconButton, uiStyles } from '@/ui';
import { useShell } from './shell-context';
import { clearSearchHistory, saveSearchKey, useSearchHistory } from './search-history';
import { t } from './i18n';
import s from './library.module.css';

export interface SuggestItem {
  key: string;
  label: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  onPick: () => void;
}

export interface SearchSpec {
  /** 搜索历史的作用域（dash/shelf/files/net/notes） */
  scope: string;
  value: string;
  onChange: (v: string) => void;
  /** 回车提交 */
  onSubmit?: (v: string) => void;
  placeholder?: string;
  /** 联想（输入非空时）；历史词由 TopBar 自己处理 */
  suggest?: (q: string) => SuggestItem[];
}

export function TopBar(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  onTitleClick?: () => void;
  nav?: 'menu' | 'back';
  onNav?: () => void;
  actions?: ReactNode;
  search?: SearchSpec;
  /** 多选态：标题与动作由页面传入，左侧变成「取消」 */
  selecting?: { count: number; onCancel: () => void; actions: ReactNode };
}) {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sp = props.search;
  const history = useSearchHistory(sp?.scope ?? '_');
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const closeSearch = () => {
    setOpen(false);
    sp?.onChange('');
  };

  if (props.selecting) {
    return (
      <div className={`${s.topbar} ${s.selectBar}`}>
        <IconButton label={t('cancel')} onClick={props.selecting.onCancel}>
          <X size={22} />
        </IconButton>
        <div className={s.topTitle}>{t('selectedCount', { n: props.selecting.count })}</div>
        {props.selecting.actions}
      </div>
    );
  }

  const nav = props.nav ?? 'menu';
  return (
    <div className={s.topbar}>
      {nav === 'menu' ? (
        <button type="button" className={`${uiStyles.iconBtn} ${s.menuBtn}`} aria-label={t('options')} onClick={props.onNav ?? shell.openDrawer}>
          <Menu size={22} />
        </button>
      ) : (
        <IconButton label={t('back')} onClick={props.onNav ?? shell.goBack}>
          <ArrowLeft size={22} />
        </IconButton>
      )}
      {open && sp ? (
        <div className={s.searchBox}>
          <Search size={18} />
          <input
            ref={inputRef}
            value={sp.value}
            placeholder={sp.placeholder ?? t('searchHint')}
            onChange={(e) => sp.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void saveSearchKey(sp.scope, sp.value);
                sp.onSubmit?.(sp.value);
                inputRef.current?.blur();
              } else if (e.key === 'Escape') closeSearch();
            }}
          />
          <button style={{ background: 'none', border: 'none', color: 'inherit', display: 'flex', cursor: 'pointer', padding: 0 }} onClick={closeSearch} aria-label={t('close')}>
            <X size={18} />
          </button>
        </div>
      ) : props.onTitleClick ? (
        <button className={`${s.topTitle} ${s.topTitleBtn}`} onClick={props.onTitleClick}>
          {props.title}
          {props.subtitle && <small>{props.subtitle}</small>}
        </button>
      ) : (
        <div className={s.topTitle}>
          {props.title}
          {props.subtitle && <small>{props.subtitle}</small>}
        </div>
      )}
      {sp && !open && (
        <IconButton label={t('search')} onClick={() => setOpen(true)}>
          <Search size={21} />
        </IconButton>
      )}
      {props.actions}
      {open && sp && <Suggest sp={sp} history={history} onDone={() => inputRef.current?.blur()} />}
    </div>
  );
}

function Suggest({ sp, history, onDone }: { sp: SearchSpec; history: string[]; onDone: () => void }) {
  const q = sp.value.trim();
  const items = q && sp.suggest ? sp.suggest(q) : [];
  const hist = q ? history.filter((h) => h.toLowerCase().includes(q.toLowerCase()) && h !== q).slice(0, 6) : history.slice(0, 12);
  if (!items.length && !hist.length) return null;
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', fontSize: 14.5 } as const;
  return (
    <div className={s.suggest} onPointerDown={(e) => e.preventDefault()}>
      {items.map((it) => (
        <div
          key={it.key}
          style={rowStyle}
          onClick={() => {
            it.onPick();
            onDone();
          }}
        >
          {it.icon}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</div>
            {it.sub && <div className={s.dim} style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sub}</div>}
          </div>
        </div>
      ))}
      {hist.map((h) => (
        <div
          key={`h-${h}`}
          style={{ ...rowStyle, color: 'var(--mr-muted)' }}
          onClick={() => {
            sp.onChange(h);
            sp.onSubmit?.(h);
            void saveSearchKey(sp.scope, h);
            onDone();
          }}
        >
          <Search size={15} /> {h}
        </div>
      ))}
      {!q && history.length > 0 && (
        <div style={{ ...rowStyle, justifyContent: 'center', color: 'var(--mr-accent)' }} onClick={() => void clearSearchHistory(sp.scope)}>
          {t('clear')}
        </div>
      )}
    </div>
  );
}
