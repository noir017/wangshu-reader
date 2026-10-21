// 配色方案对话框：读取（网格）/ 保存 / 自动日夜（THEME-003/004/005）。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MoreVertical } from 'lucide-react';
import { textSettings, themeSettings } from '@/reader/settings';
import { GroupTitle, Row, Sheet, Switch, Button, confirmDialog, openOverlay, popupMenu, promptDialog, toast } from '@/ui';
import { currentLang } from '@/core/i18n';
import { uiSettings } from '../ui-settings';
import { Drawer } from '../components/Drawer';
import { GearButton, SwitchRow } from './rows';
import { resolveBackground, textureStyleSync } from '../themes/background';
import { DAY_THEME, NIGHT_THEME, TEMP_THEME } from '../themes/builtin';
import { cleanThemeName, deleteTheme, isProtectedTheme, loadTheme, renameTheme, saveTheme, setDayNightTheme, themeExists, themeList, type ThemeEntry } from '../themes/theme-manager';
import { useReaderUi } from '../store';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export function themeDisplayName(name: string): string {
  if (name === DAY_THEME) return t('day_theme');
  if (name === NIGHT_THEME) return t('night_theme');
  return name;
}

// ───────────── 读取配色方案 ─────────────
export function openThemeLoader(): void {
  openOverlay((close) => <ThemeLoader close={close} />);
}

function Tile({ e, active, onPick, onMenu }: { e: ThemeEntry; active: boolean; onPick: () => void; onMenu: (x: number, y: number) => void }) {
  const cur = textSettings.get();
  const d = e.data;
  const bgColor = d.backgroundColor ?? cur.backgroundColor;
  const [style, setStyle] = useState<CSSProperties>(() => (d.useBackgroundImage && d.backgroundImage.startsWith('tex:') ? textureStyleSync(d.backgroundImage, bgColor) : { backgroundColor: bgColor }));
  useEffect(() => {
    if (d.useBackgroundImage && d.backgroundImage.startsWith('img:')) void resolveBackground({ useBackgroundImage: true, backgroundImage: d.backgroundImage, backgroundColor: bgColor }).then(setStyle);
  }, [d.useBackgroundImage, d.backgroundImage, bgColor]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const fontSize = Math.max(12, Math.min(18, Number(d.style?.fontSize ?? cur.fontSize)));
  const fontName = String(d.style?.fontName ?? 'serif');
  return (
    <button
      type="button"
      className={s.themeTile}
      data-active={active ? 'true' : undefined}
      style={{ ...style, color: d.fontColor, fontSize, fontFamily: /^(font|server):/.test(fontName) ? 'serif' : fontName, fontWeight: d.style?.fontBold ? 700 : 400 }}
      onClick={() => {
        if (!fired.current) onPick();
        fired.current = false;
      }}
      onPointerDown={(ev) => {
        fired.current = false;
        const { clientX, clientY } = ev;
        timer.current = setTimeout(() => {
          fired.current = true;
          onMenu(clientX, clientY);
        }, 500);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onContextMenu={(ev) => {
        ev.preventDefault();
        clearTimeout(timer.current);
        fired.current = true;
        onMenu(ev.clientX, ev.clientY);
      }}
    >
      <span className={s.themeTileName}>{themeDisplayName(e.name)}</span>
    </button>
  );
}

function ThemeLoader({ close }: { close: () => void }) {
  themeSettings.use((st) => st.userThemes);
  uiSettings.use((st) => st.hiddenThemes);
  const last = themeSettings.use((st) => st.lastTheme);
  const colorOnly = themeSettings.use((st) => st.loadThemeWithColorOnly);
  const list = themeList();

  const menu = (e: ThemeEntry, x: number, y: number) =>
    popupMenu(x, y, [
      {
        label: t('rename'),
        onSelect: async () => {
          if (isProtectedTheme(e.name)) return void toast(t('theme_cannot_change'));
          const nn = await promptDialog(t('rename_to'), e.name);
          if (nn === null) return;
          const r = renameTheme(e.name, nn);
          if (r === 'invalid') toast(t('theme_name_error'));
          else if (r === 'exists') toast(t('theme_exists'));
        },
      },
      {
        label: t('delete'),
        onSelect: async () => {
          if (isProtectedTheme(e.name)) return void toast(t('theme_cannot_delete'));
          if (await confirmDialog(`${t('delete_theme')} ${themeDisplayName(e.name)}`)) deleteTheme(e.name);
        },
      },
      { label: t('to_day_mode'), onSelect: () => setDayNightTheme('day', e.name) },
      { label: t('to_night_mode'), onSelect: () => setDayNightTheme('night', e.name) },
    ]);

  return (
    <Drawer title={t('load_from_theme')} onClose={close}>
      <div className={s.themeGrid}>
        {list.map((e) => (
          <Tile
            key={e.name}
            e={e}
            active={last === e.name}
            onPick={() => {
              loadTheme(e.name);
              close();
            }}
            onMenu={(x, y) => menu(e, x, y)}
          />
        ))}
      </div>
      <div className={s.noteText}>
        <MoreVertical size={12} style={{ verticalAlign: -2 }} /> {t('theme_change')} ({t('rename')} / {t('delete')} / {t('to_day_mode')} / {t('to_night_mode')})
      </div>
      <SwitchRow slice={themeSettings} k="loadThemeWithColorOnly" title={t('font_color_only')} />
      <SwitchRow
        slice={themeSettings}
        k="autoTheme"
        title={t('auto_theme')}
        onGear={() => openAutoThemeDialog()}
        onSet={(v) => themeSettings.set(v ? { autoTheme: true, sysDarkModeFollow: false } : { autoTheme: false })}
      />
      <SwitchRow
        slice={themeSettings}
        k="sysDarkModeFollow"
        title={t('follow_sys_dark')}
        onSet={(v) => themeSettings.set(v ? { sysDarkModeFollow: true, autoTheme: false } : { sysDarkModeFollow: false })}
      />
      <div style={{ display: 'none' }}>{colorOnly ? '' : ''}</div>
    </Drawer>
  );
}

// ───────────── 保存为配色方案 ─────────────
export async function openThemeSaver(): Promise<void> {
  const fileName = useReaderUi.getState().session?.record.fileName ?? '';
  const raw = await promptDialog(t('new_theme_name'), fileName || themeSettings.get().lastTheme);
  if (raw === null) return;
  const name = cleanThemeName(raw);
  if (!name || name === TEMP_THEME) return void toast(t('theme_name_error'));
  if (themeExists(name) && !(await confirmDialog(t('overwrite_theme', { name: themeDisplayName(name) })))) return;
  saveTheme(name);
  themeSettings.set({ lastTheme: name });
  toast(t('theme_saved', { name: themeDisplayName(name) }));
}

/** 首次改颜色后给一次提示（saveThemeHint） */
export function maybeSaveThemeHint(): void {
  if (!uiSettings.get().saveThemeHint) return;
  uiSettings.set({ saveThemeHint: false });
  toast(t('save_theme_hint'), 4500);
}

// ───────────── 自动日夜（THEME-004） ─────────────
export function hhmmToStr(v: number): string {
  const h = Math.floor(v / 100);
  const m = v % 100;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function strToHhmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 100 + mm : null;
}

export function openAutoThemeDialog(): void {
  openOverlay((close) => <AutoThemeDialog close={close} />);
}

function TimeRow(p: { enabled: boolean; onEnabled: (v: boolean) => void; time: number; onTime: (v: number) => void; setBright: boolean; onSetBright: (v: boolean) => void; bright: number; onBright: (v: number) => void }) {
  return (
    <>
      <Row title={t('auto_theme_option1')} onClick={() => p.onEnabled(!p.enabled)} right={<><input type="time" value={hhmmToStr(p.time)} disabled={!p.enabled} onClick={(e) => e.stopPropagation()} onChange={(e) => { const v = strToHhmm(e.target.value); if (v !== null) p.onTime(v); }} /><Switch checked={p.enabled} onChange={p.onEnabled} /></>} />
      <Row
        title={t('auto_theme_option2')}
        onClick={() => p.onSetBright(!p.setBright)}
        right={
          <>
            <input type="number" min={1} max={100} value={p.bright} disabled={!p.setBright} style={{ width: 56 }} onClick={(e) => e.stopPropagation()} onChange={(e) => p.onBright(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /> %
            <Switch checked={p.setBright} onChange={p.onSetBright} />
          </>
        }
      />
    </>
  );
}

function AutoThemeDialog({ close }: { close: () => void }) {
  const st = themeSettings.use((x) => x);
  return (
    <Sheet open position="center" title={t('auto_theme')} onClose={close} actions={<Button primary onClick={close}>{t('ok')}</Button>}>
      <GroupTitle>{t('auto_theme_tip1')}</GroupTitle>
      <TimeRow
        enabled={st.autoThemeDay}
        onEnabled={(v) => themeSettings.set({ autoThemeDay: v })}
        time={st.autoThemeDayTime}
        onTime={(v) => themeSettings.set({ autoThemeDayTime: v })}
        setBright={st.autoDaySetBright}
        onSetBright={(v) => themeSettings.set({ autoDaySetBright: v })}
        bright={st.autoThemeDayBrightness}
        onBright={(v) => themeSettings.set({ autoThemeDayBrightness: v })}
      />
      <GroupTitle>{t('auto_theme_tip2')}</GroupTitle>
      <TimeRow
        enabled={st.autoThemeNight}
        onEnabled={(v) => themeSettings.set({ autoThemeNight: v })}
        time={st.autoThemeNightTime}
        onTime={(v) => themeSettings.set({ autoThemeNightTime: v })}
        setBright={st.autoNightSetBright}
        onSetBright={(v) => themeSettings.set({ autoNightSetBright: v })}
        bright={st.autoThemeNightBrightness}
        onBright={(v) => themeSettings.set({ autoThemeNightBrightness: v })}
      />
    </Sheet>
  );
}

// lang 用于 Intl 时间显示（目前 <input type=time> 由浏览器本地化）
void currentLang;
void GearButton;
