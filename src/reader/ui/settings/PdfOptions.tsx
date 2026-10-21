// PDF / CBZ 选项（PrefPdf，PDF-002 / PDF-007 / COMIC-003）。固定版式的书点「可视选项」时打开它而不是文字排版选项。
import { FlipAnimation, fixedSettings, flipSettings, themeSettings, type FlipAnimationId } from '@/reader/settings';
import { Row, Switch, chooseDialog } from '@/ui';
import { Drawer } from '../components/Drawer';
import { ColorRow, PlainSelectRow, ResetRow, SelectRow, SliderRow, SwitchRow } from './rows';
import { useReaderUi } from '../store';
import { t } from '../messages';
import type { SettingsKind } from './VisualOptions';

export function isComic(format: string | undefined): boolean {
  return format === 'cbz' || format === 'cbr' || format === 'cb7';
}

export function PdfOptions({ close, onSwitch }: { close: () => void; onSwitch: (k: SettingsKind) => void }) {
  const format = useReaderUi((s) => s.session?.book.format);
  const comic = isComic(format);
  const flip = fixedSettings.use((f) => f.flipPdf);
  const fit = fixedSettings.use((f) => f.fitMode);
  const flips: FlipAnimationId[] = [FlipAnimation.None, FlipAnimation.Curl, FlipAnimation.GoogleCurl, FlipAnimation.Push, FlipAnimation.VerticalPush, FlipAnimation.Fade, FlipAnimation.Cover, FlipAnimation.VerticalCover];
  return (
    <Drawer
      title={comic ? t('cbz_options') : t('pdf_options')}
      onClose={close}
      footer={[
        { label: t('control_options'), onClick: () => onSwitch('control') },
        { label: t('miscellaneous'), onClick: () => onSwitch('misc') },
      ]}
    >
      <SelectRow
        slice={fixedSettings}
        k="pdfViewMode"
        title={t('pdf_view_mode')}
        options={[
          { value: 0, label: t('pdf_view_0') },
          { value: 1, label: t('pdf_view_1') },
          { value: 2, label: t('pdf_view_2') },
        ]}
      />
      {!comic && <SwitchRow slice={fixedSettings} k="fitDifferentPageSize" title={t('pdf_unify_page_sizes')} />}
      {!comic && (
        <SelectRow
          slice={fixedSettings}
          k="pdfRenderQuality"
          title={t('pdf_render_quality')}
          options={[
            { value: 0, label: t('pdf_q_0') },
            { value: 1, label: t('pdf_q_1') },
            { value: 2, label: t('pdf_q_2') },
          ]}
        />
      )}
      <ColorRow slice={fixedSettings} k={comic ? 'cbzBackColor' : 'pdfBackColor'} title={t('pdf_margin_color')} />
      {!comic && <SwitchRow slice={fixedSettings} k="pdfShowThumb" title={t('pdf_thumbnail_list')} />}
      {!comic && <PdfThemeRow />}
      {comic && <SwitchRow slice={fixedSettings} k="cbzSmooth" title={t('cbz_smooth')} />}
      {comic && <SwitchRow slice={fixedSettings} k="comicRtl" title={t('comic_rtl')} />}
      <PlainSelectRow
        title={t('fit_mode')}
        value={fit}
        options={[
          { value: 'page', label: t('fit_page') },
          { value: 'width', label: t('fit_width') },
          { value: 'height', label: t('fit_height') },
        ]}
        onChange={(v) => fixedSettings.set({ fitMode: v })}
      />
      <PlainSelectRow
        title={t('flip_animation')}
        value={flip}
        options={flips.map((v) => ({ value: v, label: t(`flip_${v}` as 'flip_0') }))}
        onChange={(v) => fixedSettings.set({ flipPdf: v })}
      />
      <SliderRow slice={flipSettings} k="flipSpeed" title={t('flip_speed')} min={0} max={50} />
      <ResetRow label={t('reset')} onClick={() => { fixedSettings.set({ flipPdf: fixedSettings.defaults.flipPdf }); flipSettings.set({ flipSpeed: flipSettings.defaults.flipSpeed }); }} />
      <Row
        title={t('load_from_theme')}
        onClick={async () => {
          const v = await chooseDialog(t('theme_change'), [
            { value: 0, label: t('day_theme') },
            { value: 1, label: t('night_theme') },
          ]);
          if (v !== null) setPdfNight(v === 1);
        }}
      />
    </Drawer>
  );
}

function PdfThemeRow() {
  const night = fixedSettings.use((f) => f.pdfTheme === 1);
  return <Row title={t('pdf_theme')} onClick={() => setPdfNight(!night)} right={<Switch checked={night} onChange={setPdfNight} />} />;
}

/** PDF 的夜间 = 反色渲染；与界面夜间态同步（PDF-007：一键日夜切换时同步切换） */
export function setPdfNight(night: boolean): void {
  fixedSettings.set({ pdfTheme: night ? 1 : 0 });
  themeSettings.set({ nightMode: night });
}
