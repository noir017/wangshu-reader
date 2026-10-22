// 阅读页内的功能层：选择菜单、标注/书签、目录面板、书内搜索、朗读、词典翻译、脚注与链接、看图器。
// 阅读页在 <ReaderSessionContext.Provider> 内挂载 <ReaderFeatures />；各宿主经 useReaderSession() 拿引擎，
// 订阅 session.bus 上的命令（toc.open、search.open、tts.toggle…）并执行。
import { AnnotationLayer } from './annotations/AnnotationLayer';
import { AnnotationPopupHost } from './annotations/AnnotationPopup';
import { BookmarkCorner } from './annotations/BookmarkFlow';
import { SelectionHandles } from './annotations/SelectionHandles';
import { SelectionToolbar } from './annotations/SelectionToolbar';
import { LookupHost } from './dict/index';
import { LinkHost } from './footnote';
import { ImageViewerHost } from './imageviewer/ImageViewer';
import { SearchHost } from './search';
import { TocHost } from './toc';
import { TtsHost } from './tts';

export function ReaderFeatures() {
  return (
    <>
      <AnnotationLayer />
      <SelectionToolbar />
      <SelectionHandles />
      <AnnotationPopupHost />
      <BookmarkCorner />
      <TocHost />
      <SearchHost />
      <LinkHost />
      <ImageViewerHost />
      <LookupHost />
      <TtsHost />
    </>
  );
}

// 设置入口：reader/ui 的设置界面按需调用（都需要当前会话，用 useReaderSession() 取）
export { openDictSettings, openDictHistory } from './dict/Dialogs';
export { openNamesDialog } from './names/NamesDialog';
export { openTtsMoreDialog, openTtsVoiceDialog, openTtsFilterDialog } from './tts/Dialogs';
export { openSpeakMenu } from './tts/index';
export { isTtsActive } from './tts/service';
// 链接回退栈（features 维护；reader/ui 的「返回」按钮读它的长度，点击时发 linkback.back）
export { useLinkBack, pushLinkBackHere } from './common/linkback';
export { openLinkBackHistory } from './footnote';
