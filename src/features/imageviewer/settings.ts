import { defineSettings } from '@/core/settings';

/** 看图器设置（spec 03 §3.6 画廊部分） */
export const gallerySettings = defineSettings('features.gallery', {
  /** 白色背景（原 galleryWhiteBackground，默认黑） */
  whiteBackground: false,
  /** 幻灯片间隔（秒） */
  slideshowInterval: 3,
  /** 显示底部缩略图条 */
  showStrip: true,
  /** 看图时保持屏幕常亮 */
  keepAwake: false,
});
