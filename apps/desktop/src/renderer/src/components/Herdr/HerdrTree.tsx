/**
 * HerdrTree — Herdr 控制面左侧 4 级层级树（session → workspace → tab → pane）。
 *
 * 视觉基准：docs/prototypes/herdr-desktop-ui-prototype.html 的 .left/.tree
 * （indent1/2/3、chevron ⌄/›、.state-mark 色值、.selected #e8f0ff、sub 文案）。
 * 数据源：useHerdrStore.tree（buildHerdrTree 派生）；展示态走 displayStateOf
 * （server 断线 → 全部 disconnected，禁陈旧 done）。
 * 交互：展开/收起（session/workspace/tab 行）、搜索（pane 行文本匹配）、
 * 状态过滤（全部/阻塞/待查看，按展示态匹配）、点击 pane → selectAgent + setView('pane')。
 */
import React, { useState, type CSSProperties } from 'react';
import { useI18n } from '../../i18n';
import {
  displayStateOf,
  useHerdrStore,
  type HerdrAgent,
  type HerdrDisplayState,
  type HerdrTreeTab,
  type HerdrTreeWorkspace,
} from '../../stores/herdr-store';

type HerdrTreeFilter = 'all' | 'blocked' | 'done';

const FILTERS: HerdrTreeFilter[] = ['all', 'blocked', 'done'];

/** 原型 .state-mark 色值（断线与 unknown 同为灰）。 */
const STATE_DOT: Record<HerdrDisplayState, string> = {
  working: '#2f70e8',
  blocked: '#d34b58',
  done: '#9a67dc',
  idle: '#24946a',
  unknown: '#8590a1',
  disconnected: '#8590a1',
};

const ROOT: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: '#ffffff',
  borderRight: '1px solid #dfe4eb',
  color: '#3b4758',
  fontSize: 13,
};

const HEADER: CSSProperties = {
  flex: 'none',
  height: 45,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  borderBottom: '1px solid #dfe4eb',
  fontWeight: 650,
};

const CREATE_BTN: CSSProperties = {
  width: 26,
  height: 26,
  padding: 0,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 7,
  border: '1px solid #dfe4eb',
  background: '#ffffff',
  color: '#3b4758',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1,
};

const SEARCH: CSSProperties = {
  flex: 'none',
  margin: '10px 10px 6px',
  padding: '8px 10px',
  border: '1px solid #dfe4eb',
  borderRadius: 8,
  background: '#f8fafc',
  color: '#172033',
  fontSize: 13,
  outline: 'none',
};

const FILTERS_BAR: CSSProperties = {
  flex: 'none',
  display: 'flex',
  gap: 5,
  padding: '0 10px 9px',
  overflowX: 'auto',
};

const FILTER_BTN: CSSProperties = {
  padding: '4px 8px',
  fontSize: 11,
  borderRadius: 7,
  border: '1px solid #dfe4eb',
  background: '#ffffff',
  color: '#3b4758',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const FILTER_BTN_ACTIVE: CSSProperties = {
  ...FILTER_BTN,
  background: '#eaf1ff',
  color: '#2458bd',
  border: '1px solid #cbdcff', // 与 FILTER_BTN 同用 shorthand, 避免 React 混用告警
};

const TREE_BODY: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '3px 7px 20px',
};

const EMPTY: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  minHeight: 140,
  color: '#687386',
};

const CHEV: CSSProperties = { width: 14, flex: 'none', color: '#8792a3' };
const MARK: CSSProperties = { width: 7, height: 7, flex: 'none', borderRadius: '50%' };
const LABEL: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const SUB: CSSProperties = {
  flex: 'none',
  marginLeft: 'auto',
  color: '#8a94a4',
  fontSize: 10,
  whiteSpace: 'nowrap',
};
const SELECTED: CSSProperties = { background: '#e8f0ff', color: '#2057be' };

/** 原型 .tree-row 基础 + .indent1/2/3（session 为 level 0 无缩进）。 */
function rowStyle(indent: number, selected: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    minHeight: 31,
    padding: '4px 6px',
    paddingLeft: indent === 0 ? 6 : 18 + (indent - 1) * 16,
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color: '#3b4758',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    ...(selected ? SELECTED : {}),
  };
}

export function HerdrTree(): React.JSX.Element {
  const { t } = useI18n();
  const tree = useHerdrStore((s) => s.tree);
  const server = useHerdrStore((s) => s.server);
  const selectedAgent = useHerdrStore((s) => s.selectedAgent);
  const selectAgent = useHerdrStore((s) => s.selectAgent);
  const setView = useHerdrStore((s) => s.setView);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HerdrTreeFilter>('all');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (key: string): boolean => !collapsed.has(key);
  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelect = (agent: HerdrAgent): void => {
    selectAgent(agent.name);
    setView('pane');
  };

  /** 过滤 + 搜索后的 pane 行（null = 隐藏）；sub 文案与原型一致。 */
  const computePane = (agent: HerdrAgent): { agent: HerdrAgent; display: HerdrDisplayState; sub: string } | null => {
    const display = displayStateOf(agent, server);
    const sub =
      display === 'done'
        ? `${agent.kind} · ${t('herdr.tree.filterDone')}` // done 后缀「待查看」（原型: Codex · 待查看）
        : `${agent.kind} · ${agent.pane}`;
    if (filter !== 'all' && display !== filter) return null;
    const q = query.trim().toLowerCase();
    if (q) {
      const haystack = `${agent.displayName} ${agent.kind} ${agent.pane} ${sub} ${t(`herdr.status.${display}`)}`.toLowerCase();
      if (!haystack.includes(q)) return null;
    }
    return { agent, display, sub };
  };

  const renderPanes = (tab: HerdrTreeTab): React.JSX.Element[] =>
    tab.panes
      .flatMap((agent) => {
        const pane = computePane(agent);
        return pane ? [pane] : [];
      })
      .map(({ agent, display, sub }) => {
        const selected = selectedAgent === agent.name;
        return (
          <button
            key={agent.name}
            type="button"
            data-testid="herdr-pane-row"
            data-agent={agent.name}
            data-state={display}
            title={`${agent.displayName} · ${t(`herdr.status.${display}`)}`}
            onClick={() => handleSelect(agent)}
            className={selected ? 'selected hover:bg-[#f1f4f8]' : 'hover:bg-[#f1f4f8]'}
            style={rowStyle(3, selected)}
          >
            <span aria-hidden="true" style={{ ...MARK, background: STATE_DOT[display] }} />
            <span style={LABEL}>{agent.displayName}</span>
            <span style={SUB}>{sub}</span>
          </button>
        );
      });

  const renderTabs = (ws: HerdrTreeWorkspace): React.JSX.Element[] => {
    const wsOpen = isOpen(`ws:${ws.id}`);
    return [
      <button
        key={ws.id}
        type="button"
        data-testid="herdr-ws-row"
        data-ws={ws.name}
        data-kind={ws.kind}
        onClick={() => toggle(`ws:${ws.id}`)}
        className="hover:bg-[#f1f4f8]"
        style={rowStyle(1, false)}
      >
        <span aria-hidden="true" style={CHEV}>
          {wsOpen ? '⌄' : '›'}
        </span>
        <b>◇</b>
        <span style={LABEL}>{ws.name}</span>
        <span style={SUB}>{ws.kind === 'worktree' ? t('herdr.tree.worktree') : t('herdr.tree.workspace')}</span>
      </button>,
      ...(wsOpen
        ? ws.tabs.flatMap((tab) => {
            const tabOpen = isOpen(`tab:${tab.id}`);
            return [
              <button
                key={tab.id}
                type="button"
                data-testid="herdr-tab-row"
                onClick={() => toggle(`tab:${tab.id}`)}
                className="hover:bg-[#f1f4f8]"
                style={rowStyle(2, false)}
              >
                <span aria-hidden="true" style={CHEV}>
                  {tabOpen ? '⌄' : '›'}
                </span>
                <span>▣</span>
                <span style={LABEL}>{tab.name}</span>
              </button>,
              ...(tabOpen ? renderPanes(tab) : []),
            ];
          })
        : []),
    ];
  };

  const sessionOpen = isOpen('session');

  return (
    <div data-testid="herdr-tree" style={ROOT}>
      <div style={HEADER}>
        <span>{t('herdr.tree.title')}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          type="button"
          title={t('herdr.tree.create')}
          aria-label={t('herdr.tree.create')}
          className="hover:bg-[#f8fafc]"
          style={CREATE_BTN}
        >
          ＋
        </button>
      </div>

      <input
        data-testid="herdr-tree-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('herdr.tree.searchPlaceholder')}
        className="focus:border-[#78a5ff]"
        style={SEARCH}
      />

      <div style={FILTERS_BAR}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            data-testid="herdr-filter"
            data-filter={f}
            onClick={() => setFilter(f)}
            className={filter === f ? 'active' : undefined}
            style={filter === f ? FILTER_BTN_ACTIVE : FILTER_BTN}
          >
            {t(`herdr.tree.filter${f[0].toUpperCase()}${f.slice(1)}`)}
          </button>
        ))}
      </div>

      <div style={TREE_BODY}>
        {tree.workspaces.length === 0 ? (
          <div data-testid="herdr-tree-empty" style={EMPTY}>
            {t('herdr.tree.empty')}
          </div>
        ) : (
          <>
            {/* 会话行常显（可折叠子级） */}
            <button
              type="button"
              data-testid="herdr-session-row"
              onClick={() => toggle('session')}
              className="hover:bg-[#f1f4f8]"
              style={rowStyle(0, false)}
            >
              <span aria-hidden="true" style={CHEV}>
                {sessionOpen ? '⌄' : '›'}
              </span>
              <b>
                ◫ {t('herdr.tree.session')}
              </b>
              <span style={LABEL}>{tree.session}</span>
            </button>
            {sessionOpen ? tree.workspaces.flatMap(renderTabs) : null}
          </>
        )}
      </div>
    </div>
  );
}
