// 生词本与「自定义词典设置」对话框。
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Trash2 } from 'lucide-react';
import { appSettings } from '@/core/app-settings';
import type { ReaderSession } from '@/core/reader-session';
import { Button, confirmDialog, GroupTitle, IconButton, Row, Select, Sheet, Switch, TextInput } from '@/ui';
import { formatDateTime } from '../common/format';
import { downloadText } from '../common/clipboard';
import { tc } from '../common/messages';
import { openSessionOverlay } from '../common/overlay';
import { moveItem, selectBarSettings, toggleItem, MAIN_SLOTS, normalizeBar, DEFAULT_BAR } from '../annotations/toolbar-config';
import { barItemLabel } from '../annotations/bar-labels';
import { clearDictHistory, getDictHistory, historyToCsv, removeDictHistory, type DictHistoryItem } from './history';
import { lookupWord } from './lookup';
import { td } from './messages';
import { dictSettings } from './settings';
import { DICT_SOURCES, isSafeHttpUrl, TRANSLATE_LANGS } from './sources';

export function openDictHistory(session: ReaderSession): void {
  openSessionOverlay(session, (close) => <HistoryDialog session={session} close={close} />);
}

export function openDictSettings(session: ReaderSession): void {
  openSessionOverlay(session, (close) => <DictSettingsDialog close={close} />);
}

function HistoryDialog({ session, close }: { session: ReaderSession; close: () => void }) {
  const [list, setList] = useState<DictHistoryItem[] | null>(null);
  useEffect(() => {
    void getDictHistory().then(setList);
  }, []);
  const remove = async (word: string) => {
    await removeDictHistory(word);
    setList((l) => l?.filter((h) => h.word !== word) ?? l);
  };
  return (
    <Sheet
      open
      position="center"
      title={td('historyTitle')}
      onClose={close}
      headerRight={
        <>
          <IconButton label={td('exportCsv')} disabled={!list?.length} onClick={() => list && downloadText('moonreader-words.csv', historyToCsv(list), 'text/csv')}>
            <Download size={18} />
          </IconButton>
          <IconButton
            label={td('clearHistory')}
            disabled={!list?.length}
            onClick={async () => {
              if (await confirmDialog(td('clearHistoryConfirm'))) {
                await clearDictHistory();
                setList([]);
              }
            }}
          >
            <Trash2 size={18} />
          </IconButton>
        </>
      }
    >
      {list === null ? null : list.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--mr-muted)' }}>{td('historyEmpty')}</div>
      ) : (
        list.map((h) => (
          <Row
            key={h.word}
            title={h.word}
            subtitle={`${h.context ? h.context + ' · ' : ''}${formatDateTime(h.at)}${h.book ? ' · ' + h.book : ''}`}
            right={
              <>
                {h.count > 1 && <span>{td('times', { n: h.count })}</span>}
                <IconButton
                  label={tc('delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(h.word);
                  }}
                  style={{ width: 32, height: 32 }}
                >
                  <Trash2 size={16} />
                </IconButton>
              </>
            }
            onClick={() => {
              close();
              lookupWord(session, h.word);
            }}
          />
        ))
      )}
    </Sheet>
  );
}


function DictSettingsDialog({ close }: { close: () => void }) {
  const s = dictSettings.use((x) => x);
  const bar = selectBarSettings.use((x) => x.items);
  const zh = appSettings.use((x) => x.language) === 'zh';
  const items = normalizeBar(bar);
  const sourceOptions = DICT_SOURCES.map((d) => ({ value: d.id, label: zh ? d.name : (d.nameEn ?? d.name) }));
  const needCustom = s.dict1 === 'custom' || s.dict2 === 'custom';
  const customOk = !needCustom || (s.myDictUrl.includes('%s') && isSafeHttpUrl(s.myDictUrl.replace('%s', 'x')));
  const langs = (auto: boolean) => TRANSLATE_LANGS.filter((l) => auto || l.code !== 'auto').map((l) => ({ value: l.code, label: zh ? l.zh : l.en }));

  return (
    <Sheet open position="center" title={td('customizeTitle')} onClose={close} actions={<Button primary onClick={close}>{tc('ok')}</Button>}>
      <GroupTitle>{td('selectBar')}</GroupTitle>
      {items.map((it, i) => (
        <Row
          key={it.id}
          title={barItemLabel(it.id)}
          icon={<Switch checked={it.on} disabled={i < MAIN_SLOTS} onChange={() => selectBarSettings.set({ items: toggleItem(items, i) })} />}
          right={
            <>
              <IconButton label={tc('moveUp')} disabled={i === 0} onClick={() => selectBarSettings.set({ items: moveItem(items, i, i - 1) })} style={{ width: 32, height: 32 }}>
                <ArrowUp size={16} />
              </IconButton>
              <IconButton label={tc('moveDown')} disabled={i === items.length - 1} onClick={() => selectBarSettings.set({ items: moveItem(items, i, i + 1) })} style={{ width: 32, height: 32 }}>
                <ArrowDown size={16} />
              </IconButton>
            </>
          }
        />
      ))}
      <Row title={tc('reset')} onClick={() => selectBarSettings.set({ items: DEFAULT_BAR.map((x) => ({ ...x })) })} />

      <GroupTitle>{td('dictionary')}</GroupTitle>
      <Row title={td('dict1')} subtitle={td('dict1Hint')} right={<Select value={s.dict1} options={sourceOptions} onChange={(v) => dictSettings.set({ dict1: v })} />} />
      <Row title={td('dict2')} subtitle={td('dict2Hint')} right={<Select value={s.dict2} options={sourceOptions} onChange={(v) => dictSettings.set({ dict2: v })} />} />
      {needCustom && (
        <div style={{ padding: '4px 16px 8px' }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{td('customUrlTitle')}</div>
          <TextInput value={s.myDictUrl} onChange={(v) => dictSettings.set({ myDictUrl: v })} placeholder={td('customUrlHint')} />
          {!customOk && <div style={{ color: '#d9534f', fontSize: 13, marginTop: 4 }}>{td('customUrlInvalid')}</div>}
        </div>
      )}

      <GroupTitle>{td('translation')}</GroupTitle>
      <Row title={td('sourceLang')} right={<Select value={s.sourceLanguage} options={langs(true)} onChange={(v) => dictSettings.set({ sourceLanguage: v })} />} />
      <Row title={td('destLang')} right={<Select value={s.destLanguage} options={langs(false)} onChange={(v) => dictSettings.set({ destLanguage: v })} />} />

      <Row title={td('openDictDirect')} onClick={() => dictSettings.set({ openDictDirect: !s.openDictDirect })} right={<Switch checked={s.openDictDirect} onChange={(v) => dictSettings.set({ openDictDirect: v })} />} />
      {zh && <Row title={td('oneCharDict')} subtitle={td('oneCharDictHint')} onClick={() => dictSettings.set({ oneCharDict: !s.oneCharDict })} right={<Switch checked={s.oneCharDict} onChange={(v) => dictSettings.set({ oneCharDict: v })} />} />}
    </Sheet>
  );
}
