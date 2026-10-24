// 可视选项（PrefVisual，VIEW-009 / TYPO-* / THEME-006 / ANIM-001）。修改即时生效。
import { Minus, Plus } from 'lucide-react';
import { currentLang } from '@/core/i18n';
import { FlipAnimation, controlSettings, flipSettings, textSettings, type FlipAnimationId } from '@/reader/settings';
import { Row, Slider, toast } from '@/ui';
import { Drawer } from '../components/Drawer';
import { ColorRow, NoteText, PlainSelectRow, ResetRow, SelectRow, SliderRow, SwitchRow } from './rows';
import { useFontSizeDraft } from './font-size-hook';
import { ENCODINGS, HYPHEN_LANGS, MAX_FONT_SIZE, MAX_MARGIN, MIN_FONT_SIZE, langName, paraToPct, pctToPara, resetTextKeys } from './options-data';
import { openFontPicker } from './FontPicker';
import { openBackgroundPicker } from './BackgroundPicker';
import { maybeSaveThemeHint, openThemeLoader, openThemeSaver } from './ThemeDialogs';
import { FlipIcon } from './FlipIcon';
import { useFontLabel } from './font-names';
import { colorValue } from '../themes/theme-manager';
import { uiSettings } from '../ui-settings';
import { t } from '../messages';
import s from '../reader-ui.module.css';

export type SettingsKind = 'visual' | 'control' | 'misc';

/** 选背景色后按亮度自动换字色（PrefVisual.checkFontColor，VIEW-023）：深底配深字 / 浅底配浅字时换成上次用的另一种 */
export function autoFontColorFor(bg: string, font: string): string | null {
  const bv = colorValue(bg);
  const fv = colorValue(font);
  const ui = uiSettings.get();
  if (bv < 126 * 3 && fv < 126 * 3) return ui.lastLightFontColor;
  if (bv > 126 * 3 && fv > 126 * 3) return ui.lastDarkFontColor;
  return null;
}

export function VisualOptions({ close, onSwitch }: { close: () => void; onSwitch: (k: SettingsKind) => void }) {
  const lang = currentLang();
  const { size, apply, nudge } = useFontSizeDraft();
  const fontName = textSettings.use((x) => x.fontName);
  const fontColor = textSettings.use((x) => x.fontColor);
  const bgImage = textSettings.use((x) => x.useBackgroundImage);
  const underline = textSettings.use((x) => x.fontUnderline);
  const dash = textSettings.use((x) => x.dashUnderline);
  const hyph = textSettings.use((x) => x.textHyphenation);
  const flip = flipSettings.use((x) => x.flipAnimation);
  const hyphLang = textSettings.use((x) => x.hyphenationLang);
  const fontLabel = useFontLabel(fontName);

  const setFontColor = (v: string) => {
    textSettings.set({ fontColor: v });
    // 记住用户最近用过的浅/深字色，供选背景时自动切换
    if (colorValue(v) > 355) uiSettings.set({ lastLightFontColor: v });
    else if (colorValue(v) < 300) uiSettings.set({ lastDarkFontColor: v });
    maybeSaveThemeHint();
  };
  const setBgColor = (v: string) => {
    const f = textSettings.get().fontColor;
    const patch: Record<string, unknown> = { backgroundColor: v.slice(0, 7), useBackgroundImage: false };
    const auto = autoFontColorFor(v, f);
    if (auto) patch.fontColor = auto;
    textSettings.set(patch);
    maybeSaveThemeHint();
  };

  const chooseFlip = (v: FlipAnimationId) => {
    flipSettings.set({ flipAnimation: v });
    const c = controlSettings.get();
    // 1/2/3/6 支持手指跟随，只有左右区域才合理：上下模式自动改左右模式并提示
    if (([1, 2, 3, 6] as number[]).includes(v) && c.tapMode < 4 && !c.toggleTapMode) {
      controlSettings.set({ toggleTapMode: true });
      toast(t('switch_left_right_mode'), 3500);
    }
  };

  const flips: FlipAnimationId[] = [FlipAnimation.None, FlipAnimation.Curl, FlipAnimation.GoogleCurl, FlipAnimation.Push, FlipAnimation.VerticalPush, FlipAnimation.Fade, FlipAnimation.Cover, FlipAnimation.VerticalCover];

  return (
    <Drawer
      title={t('visual_options')}
      onClose={close}
      footer={[
        { label: t('control_options'), onClick: () => onSwitch('control') },
        { label: t('miscellaneous'), onClick: () => onSwitch('misc') },
      ]}
    >
      <SelectRow slice={textSettings} k="textEncode" title={t('text_encoding')} options={ENCODINGS.map((e) => ({ value: e.value, label: e.value === 'auto' ? t('enc_auto') : e.label }))} />

      {/* 文字大小：滑条 + 微调（原版为整数/小数两个滚轮） */}
      <Slider
        label={t('font_size')}
        value={size}
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        step={0.1}
        format={(v) => v.toFixed(1)}
        left={<StepBtn onClick={() => nudge(-0.1)} icon={<Minus size={16} />} />}
        right={<StepBtn onClick={() => nudge(0.1)} icon={<Plus size={16} />} />}
        onChange={(v) => apply(v)}
        onCommit={(v) => apply(v, true)}
      />

      <ColorRow slice={textSettings} k="fontColor" title={t('font_color')} onSet={setFontColor} />
      <ColorRow slice={textSettings} k="backgroundColor" title={t('background_color')} onSet={setBgColor} right={!bgImage ? <Mark /> : undefined} />
      <Row title={t('background_image')} onClick={openBackgroundPicker} right={bgImage ? <Mark /> : undefined} />

      <Row title={t('font_name')} onClick={() => openFontPicker({ get: () => textSettings.get().fontName, set: (v) => textSettings.set({ fontName: v }) })} right={<span style={{ fontFamily: /^(font|server):/.test(fontName) ? undefined : fontName }}>{fontLabel}</span>} />
      <SwitchRow slice={textSettings} k="fontBold" title={t('bold')} />
      <SwitchRow slice={textSettings} k="fontItalic" title={t('italic')} />
      <SwitchRow slice={textSettings} k="fontUnderline" title={t('underline')} />
      {underline && (
        <PlainSelectRow
          title={<span className={s.sub}>{t('underline')}:</span>}
          value={dash ? 1 : 0}
          options={[
            { value: 0, label: t('solid_line') },
            { value: 1, label: t('dashed_line') },
          ]}
          onChange={(v) => textSettings.set({ dashUnderline: v === 1 })}
        />
      )}
      <SwitchRow slice={textSettings} k="fontShadow" title={t('fontshadow')} />

      <SwitchRow
        slice={textSettings}
        k="textJustified"
        title={t('align_justified')}
        // 断字依赖两端对齐：开着断字时不允许关
        onSet={(v) => textSettings.set(v ? { textJustified: true } : { textJustified: false, textHyphenation: false })}
      />
      <SwitchRow
        slice={textSettings}
        k="textHyphenation"
        title={t('hyphenation')}
        // 开断字：强制两端对齐、关闭 CJK 模式
        onSet={(v) => textSettings.set(v ? { textHyphenation: true, textJustified: true, textCJK: false } : { textHyphenation: false })}
      />
      {hyph && (
        <Row
          title={<span className={s.sub}>{t('hyphenation_dict')}</span>}
          right={
            <select
              value={hyphLang}
              onChange={(e) => textSettings.set({ hyphenationLang: e.target.value })}
              style={{ font: 'inherit', background: 'var(--mr-surface)', color: 'var(--mr-fg)', border: '1px solid var(--mr-border)', borderRadius: 6, padding: '6px 8px', maxWidth: 160 }}
            >
              <option value="">{t('hyph_auto')}</option>
              {HYPHEN_LANGS.map((c) => (
                <option key={c} value={c}>
                  {langName(c, lang)}
                </option>
              ))}
            </select>
          }
        />
      )}
      <SwitchRow
        slice={textSettings}
        k="textCJK"
        title={t('asia_language')}
        // 开 CJK：强制两端对齐、关断字；关 CJK 时同时关紧凑模式
        onSet={(v) => textSettings.set(v ? { textCJK: true, textJustified: true, textHyphenation: false } : { textCJK: false, textDense: false })}
      />
      <SwitchRow slice={textSettings} k="textDense" title={t('text_dense')} subtitle={undefined} onSet={(v) => textSettings.set(v ? { textDense: true, textCJK: true, textJustified: true } : { textDense: false })} />
      <SwitchRow slice={textSettings} k="textJian2Fan" title={t('chinese_jian2fan')} onSet={(v) => textSettings.set(v ? { textJian2Fan: true, textFan2Jian: false } : { textJian2Fan: false })} />
      <SwitchRow slice={textSettings} k="textFan2Jian" title={t('chinese_fan2jian')} onSet={(v) => textSettings.set(v ? { textFan2Jian: true, textJian2Fan: false } : { textFan2Jian: false })} />

      <SliderRow slice={textSettings} k="paragraphSpace" title={t('paragraph_space')} min={0} max={200} step={10} toSlider={paraToPct} fromSlider={pctToPara} format={(v) => `${v}%`} />
      <SliderRow slice={textSettings} k="lineSpace" title={t('line_space')} min={-5} max={20} />
      <SliderRow slice={textSettings} k="fontSpace" title={t('letter_space')} min={-4} max={20} />
      <SliderRow slice={textSettings} k="fontScale" title={t('font_scale')} min={-4} max={20} />
      <ResetRow label={t('reset')} onClick={() => resetTextKeys(['paragraphSpace', 'lineSpace', 'fontSpace', 'fontScale'])} />

      <SliderRow slice={textSettings} k="leftMargin" title={t('left_margin')} min={0} max={MAX_MARGIN} />
      <SliderRow slice={textSettings} k="rightMargin" title={t('right_margin')} min={0} max={MAX_MARGIN} />
      <SliderRow slice={textSettings} k="topMargin" title={t('top_margin')} min={0} max={MAX_MARGIN} />
      <SliderRow slice={textSettings} k="bottomMargin" title={t('bottom_margin')} min={0} max={MAX_MARGIN} />
      <ResetRow label={t('reset')} onClick={() => resetTextKeys(['leftMargin', 'rightMargin', 'topMargin', 'bottomMargin'])} />

      <div style={{ display: 'flex', gap: 8, padding: '6px 16px' }}>
        <button type="button" className={s.footBtn} onClick={openThemeSaver}>
          {t('save_as_theme')}
        </button>
        <button type="button" className={s.footBtn} onClick={openThemeLoader}>
          {t('load_from_theme')}
        </button>
      </div>

      <Row
        title={t('flip_animation')}
        right={
          <select
            value={flip}
            onChange={(e) => chooseFlip(Number(e.target.value) as FlipAnimationId)}
            style={{ font: 'inherit', background: 'var(--mr-surface)', color: 'var(--mr-fg)', border: '1px solid var(--mr-border)', borderRadius: 6, padding: '6px 8px' }}
          >
            {flips.map((v) => (
              <option key={v} value={v}>
                {t(`flip_${v}` as 'flip_0')}
              </option>
            ))}
          </select>
        }
      />
      <div className={s.flipGrid}>
        {flips.map((v) => (
          <button key={v} type="button" className={s.flipItem} data-active={flip === v ? 'true' : undefined} onClick={() => chooseFlip(v)} title={t(`flip_${v}` as 'flip_0')}>
            <FlipIcon kind={v} />
          </button>
        ))}
      </div>
      {flip !== FlipAnimation.None && <SliderRow slice={flipSettings} k="flipSpeed" title={t('flip_speed')} min={0} max={50} />}
      {/* 「允许左右划动翻页」「触碰时禁止上下滑动」只放在其它选项（带横划动画齿轮那份），这里不再重复 */}
      <ResetRow
        label={t('reset')}
        onClick={() => flipSettings.set({ flipAnimation: flipSettings.defaults.flipAnimation, flipSpeed: flipSettings.defaults.flipSpeed })}
      />
      <NoteText>{t('brightness_note')}</NoteText>
    </Drawer>
  );
}

function Mark() {
  return <span style={{ color: 'var(--mr-accent)', fontWeight: 700 }}>✓</span>;
}

function StepBtn({ onClick, icon }: { onClick: () => void; icon: React.ReactNode }) {
  return (
    <button type="button" className={s.stepBtn} onClick={onClick}>
      {icon}
    </button>
  );
}

