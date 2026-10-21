// 名字替换设置界面（MISC-002）：规则表（原文/替换/正则/启用/作用域）。改动即写 nameSettings，引擎订阅后重排。
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ReaderSession } from '@/core/reader-session';
import { nameSettings } from '@/reader/engine/transforms';
import { Button, confirmDialog, IconButton, openOverlay, Sheet, Switch, toast } from '@/ui';
import { copyText } from '../common/clipboard';
import { tc } from '../common/messages';
import { openSessionOverlay } from '../common/overlay';
import css from '../common/features.module.css';
import { tn } from './messages';
import { activeRulesFor, parseRuleLines, ruleLines, scopeOf, validateRule, withScope, type NameRule } from './rules';

function ImportBody({ onDone }: { onDone: (text: string | null) => void }) {
  const [text, setText] = useState('');
  return (
    <Sheet
      open
      position="center"
      title={tn('importTitle')}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button onClick={() => onDone(null)}>{tc('cancel')}</Button>
          <Button primary onClick={() => onDone(text)}>
            {tc('ok')}
          </Button>
        </>
      }
    >
      <div className={css.pad}>
        <textarea className={css.textarea} data-testid="names-import-text" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
    </Sheet>
  );
}

function RuleRow({ rule, bookTitle, onChange, onDelete }: { rule: NameRule; bookTitle: string; onChange: (r: NameRule) => void; onDelete: () => void }) {
  const err = validateRule(rule);
  const scope = scopeOf(rule);
  return (
    <div className={css.pad} style={{ borderBottom: '1px solid var(--mr-border)' }} data-testid="names-rule">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: 6, alignItems: 'center' }}>
        <input className={css.filterInput} data-testid="names-from" placeholder={tn('from')} value={rule.from} onChange={(e) => onChange({ ...rule, from: e.target.value })} />
        <input className={css.filterInput} data-testid="names-to" placeholder={tn('to')} value={rule.to} onChange={(e) => onChange({ ...rule, to: e.target.value })} />
        <IconButton label={tc('delete')} onClick={onDelete} style={{ width: 36, height: 36 }}>
          <Trash2 size={17} />
        </IconButton>
      </div>
      <div className={css.row2} style={{ marginTop: 6, flexWrap: 'wrap' }}>
        <label className={css.row2} style={{ gap: 6, fontSize: 13 }}>
          <Switch checked={rule.enabled !== false} onChange={(v) => onChange({ ...rule, enabled: v })} />
          {tn('enabled')}
        </label>
        <label className={css.row2} style={{ gap: 6, fontSize: 13 }}>
          <Switch checked={!!rule.regex} onChange={(v) => onChange({ ...rule, regex: v })} />
          {tn('regex')}
        </label>
        <button
          type="button"
          className={css.chip}
          data-testid="names-scope"
          data-active={scope === 'book' ? 'true' : undefined}
          disabled={!bookTitle}
          onClick={() => onChange(withScope(rule, scope === 'book' ? 'global' : 'book', bookTitle))}
        >
          {scope === 'book' ? tn('scopeBook') : tn('scopeGlobal')}
        </button>
      </div>
      {err && <div className={css.warn} style={{ padding: '4px 0 0' }}>{err === 'regex' ? tn('badRegex') : tn('badEmpty')}</div>}
    </div>
  );
}

function NamesBody({ session, close }: { session: ReaderSession; close: () => void }) {
  const rules = nameSettings.use((s) => s.rules);
  const bookTitle = session.book.metadata.title ?? '';
  const set = (next: NameRule[]) => nameSettings.set({ rules: next });
  // 本书规则里只显示本书的；别的书的规则留在表里不动
  const shown = rules.map((r, i) => ({ r, i })).filter(({ r }) => !r.book || r.book === bookTitle);

  const importRules = async () => {
    const text = await new Promise<string | null>((resolve) => openOverlay((done) => <ImportBody onDone={(v) => (done(), resolve(v))} />));
    if (text === null) return;
    const list = parseRuleLines(text);
    if (!list.length) return;
    set([...rules, ...list]);
    toast(tn('imported', { n: list.length }));
  };

  return (
    <Sheet
      open
      position="center"
      title={tn('title')}
      onClose={close}
      headerRight={
        <IconButton label={tn('add')} onClick={() => set([...rules, { from: '', to: '' }])}>
          <Plus size={20} />
        </IconButton>
      }
      actions={<Button primary onClick={close}>{tc('ok')}</Button>}
    >
      <div className={css.muted} style={{ padding: '8px 16px', lineHeight: 1.5 }}>
        {tn('hint')}
      </div>
      {shown.length === 0 && <div className={css.empty}>{tn('empty')}</div>}
      {shown.map(({ r, i }) => (
        <RuleRow key={i} rule={r} bookTitle={bookTitle} onChange={(n) => set(rules.map((x, j) => (j === i ? n : x)))} onDelete={() => set(rules.filter((_, j) => j !== i))} />
      ))}
      <div className={css.chips}>
        <span className={css.muted} style={{ alignSelf: 'center' }}>
          {tn('active', { n: activeRulesFor(rules, bookTitle).length })}
        </span>
        <span className={css.grow} />
        <button type="button" className={css.chip} onClick={async () => toast((await copyText(ruleLines(shown.map((x) => x.r)))) ? tn('copied') : tc('copyFailed'))}>
          {tn('exportLines')}
        </button>
        <button type="button" className={css.chip} onClick={() => void importRules()}>
          {tn('importLines')}
        </button>
        <button
          type="button"
          className={css.chip}
          disabled={!shown.length}
          onClick={async () => {
            if (await confirmDialog(tn('confirmClear'))) set(rules.filter((r) => !!r.book && r.book !== bookTitle));
          }}
        >
          {tn('deleteAll')}
        </button>
      </div>
    </Sheet>
  );
}

export function openNamesDialog(session: ReaderSession): void {
  openSessionOverlay(session, (close) => <NamesBody session={session} close={close} />);
}
