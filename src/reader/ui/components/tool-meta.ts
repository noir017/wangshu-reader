// 20 个工具按钮的图标与文案键（图标用 lucide 重绘，不用 apk 位图）
import {
  BookmarkIcon,
  CloudDownload,
  CloudUpload,
  Columns2,
  Contrast,
  ListTree,
  MoonStar,
  Palette,
  Power,
  ScreenShare,
  Search,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Type,
  Volume2,
  ChevronsDown,
  Eye,
  SquareMenu,
  type LucideIcon,
} from 'lucide-react';
import { ToolButton } from '../ui-settings';
import type { t } from '../messages';

export interface ToolMeta {
  icon: LucideIcon;
  label: Parameters<typeof t>[0];
}

export const TOOL_META: Record<number, ToolMeta> = {
  [ToolButton.Orientation]: { icon: ScreenShare, label: 'btn_orientation' },
  [ToolButton.DayNight]: { icon: MoonStar, label: 'btn_daynight' },
  [ToolButton.Speak]: { icon: Volume2, label: 'btn_speak' },
  [ToolButton.AutoScroll]: { icon: ChevronsDown, label: 'btn_autoscroll' },
  [ToolButton.Chapters]: { icon: ListTree, label: 'btn_chapters' },
  [ToolButton.Bookmarks]: { icon: BookmarkIcon, label: 'btn_bookmarks' },
  [ToolButton.Brightness]: { icon: Sun, label: 'btn_brightness' },
  [ToolButton.FontSize]: { icon: Type, label: 'btn_fontsize' },
  [ToolButton.Search]: { icon: Search, label: 'btn_search' },
  [ToolButton.Tilt]: { icon: Smartphone, label: 'btn_tilt' },
  [ToolButton.Visual]: { icon: Eye, label: 'btn_visual' },
  [ToolButton.Control]: { icon: SlidersHorizontal, label: 'btn_control' },
  [ToolButton.Misc]: { icon: SquareMenu, label: 'btn_misc' },
  [ToolButton.Themes]: { icon: Palette, label: 'btn_themes' },
  [ToolButton.Options]: { icon: Settings2, label: 'btn_options' },
  [ToolButton.Shutdown]: { icon: Power, label: 'btn_shutdown' },
  [ToolButton.DualPage]: { icon: Columns2, label: 'btn_dualpage' },
  [ToolButton.Customize]: { icon: Contrast, label: 'btn_customize' },
  [ToolButton.SyncUp]: { icon: CloudUpload, label: 'btn_sync_up' },
  [ToolButton.SyncDown]: { icon: CloudDownload, label: 'btn_sync_down' },
};

void Sun;
