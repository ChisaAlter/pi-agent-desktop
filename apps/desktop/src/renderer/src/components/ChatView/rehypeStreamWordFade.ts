/**
 * rehypeStreamWordFade — 流式正文逐词淡入(移植自 makecindy/cindy
 * apps/desktop/src/renderer/components/chat/rehypeStreamWordFade.ts, Apache-2.0)。
 *
 * 形态:流式输出时,每个新词以 150ms opacity 淡入「浮现」,而不是硬蹦出来。
 * 这**不是**被红线禁止的逐字打字机 —— 词整体已渲染就位,只有透明度渐变;
 * 设计裁决按「浮现 ≠ 打字」放行。
 *
 * 架构:CSS 管形态、JS 只管时序:
 *   - 本插件仅在 isStreaming 且非 reduced-motion 时挂进 rehype 链尾,把文本节点
 *     切词并包 `<span class="stream-word" style="--wf-delay:Nms">`;动画本体是
 *     globals.css 的 stream-word-in(淡入,`both` 填充,delay 前隐藏)。
 *   - **不重播 —— 内容匹配的稳定 key**:delay 与 settled 都按词的稳定 key 记账,
 *     不按文档序号。每次 parse 把本次词列表与上一次(state.previous)做匹配:
 *     同位置内容相等或前缀延续(chunk 边界半个词长成整词)→ 复用旧 key;错位则
 *     按内容从后往前找未被占用的旧 key(结构变化整体平移的词都能找回自己);都
 *     没有才发新 key。markdown 结构变化只会让**词序号**漂移,key 不漂。
 *   - **settled 落袋 + settled 前缀还原纯文本**:span 带 data-wf-key,
 *     MarkdownRenderer 根节点监听冒泡的 animationend(markSettledFromAnimationEnd),
 *     播完的 key 进 state.settled;settled 词从槽位中还原为合并后的原生文本,
 *     只保留仍在播放的尾部 span——流式长文档的元素数因此回落到与无动效渲染
 *     同阶,react-markdown 每 tick 的重建 + diff 不随已播完的前文线性涨。
 *   - **timeline 队列 + 背压**:delay 不按 tick 静态起算,而是对着
 *     state.nextStartAtMs(队列尾部绝对时间戳)动态分配:新词排在
 *     max(队列尾, now),随后尾部推进一个步长(上限 24ms/词,按剩余预算自适应
 *     压缩,见 planTickStep)。跨 tick 连续 —— 上游卡顿后突发的大段文字即使
 *     分落多个 parse tick,后到的词也永远排在先到的词后面(不插队、不乱序)。
 *   - **remount 免疫 —— 存开播时刻、每 tick 发剩余 delay**:state 记的是
 *     **绝对开播时刻**,每个 tick 重新发出「开播时刻 - now」:已过时刻发
 *     **负 delay**,CSS 负 animation-delay 让动画从中途续播,remount 后帧级
 *     跳回正确进度,观感无缝。
 *   - 流式结束(isStreaming 翻 false)由 MarkdownRenderer 切回无插件的常量链,
 *     终版渲染没有任何 span 包装,state 随 memo 一起被回收。
 *
 * 跳过:code / pre(代码块保持整体形态)与 KaTeX 子树(公式内部是几十个定位
 * span,逐词包装会拆坏排版)。
 *
 * 淡入对象模型:**只有文本词段和列表圆点两类东西淡入,结构永远即时出现**。
 * 表格边框、引用 rail、分隔线不做块级整体淡入。列表圆点(::marker)单独处理:
 * li 打 data-stream-marker,delay/key **借用 li 内第一个词** —— 圆点与它的
 * 文字同帧浮现,不占队列位,空 li 长出文字也不重播。标记用 data 属性而不是
 * className(MarkdownRenderer 的自定义 renderer 是 className spread 写法,
 * hast 塞 className 会覆盖样式类;data-* 从 spread 直通,互不相扰)。
 *
 * 切词用 Intl.Segmenter(granularity: 'word'):CJK 无空格也能按词切,避免整句
 * 中文一次性淡入退化成"逐句蹦"。空白并入前一词,不为纯空白生成 span。
 */

// 不 import unified/hast 类型(它们是 remark 的传递依赖, 非本包直接依赖)。
// 用最小结构类型描述 hast 节点, 插件运行时只依赖这些字段。

/** hast 元素(最小子集)。 */
interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}
/** hast 文本。 */
interface HastText {
  type: 'text';
  value: string;
}
/** hast 节点联合。 */
type HastNode = HastElement | HastText;
/** 插件工厂签名(与 unified Plugin 兼容): 接收 state, 返回树 transformer。 */
type HastTransformer = (state: WordFadeState) => (tree: HastElement) => void;

/** 逐词 stagger 步长上限(慢速输出时的标准节奏)。 */
const STEP_MS = 24;
/**
 * 排程超前量预算:每个 parse tick 按「剩余预算 / 本 tick 新词数」现算本 tick
 * 的步长(封顶 STEP_MS,见 planTickStep)。消费速率自动匹配任意到达速率:慢模型
 * 恒拿 24ms,快模型步长自动压小,积压永远收敛在预算内 —— 文字落后数据到达
 * 最多约 MAX_LEAD_MS + 动画时长,与模型无关。
 */
const MAX_LEAD_MS = 320;

interface PreviousSegment {
  content: string;
  key: string;
}

export interface WordFadeState {
  /** 稳定 key 发号器。 */
  nextId: number;
  /** 上一次 parse 的词列表(文档序),内容匹配复用 key 的依据。 */
  previous: PreviousSegment[];
  /**
   * key → 绝对开播时刻(performance.now() 基准)。只排一次;每个 tick 由
   * 「开播时刻 - now」重新发出剩余 delay(可为负,负值 = CSS 从中途续播)。
   * 存绝对时刻而不是固定 delay,是 remount 免疫的关键。
   */
  startAtByKey: Map<string, number>;
  /** 已播完淡入的 key(animationend 落袋)。后续 parse 摘掉动画类。 */
  settled: Set<string>;
  /** timeline 队列尾部的绝对时间戳(performance.now() 基准),跨 tick 连续。 */
  nextStartAtMs: number;
  /** 本 tick 的自适应步长(planTickStep 计算,ensureDelay 消费)。 */
  tickStepMs: number;
  /** 时钟注入口,仅测试用;生产恒为 performance.now。 */
  nowFn?: () => number;
}

export function createWordFadeState(): WordFadeState {
  return {
    nextId: 0,
    previous: [],
    startAtByKey: new Map(),
    settled: new Set(),
    nextStartAtMs: 0,
    tickStepMs: STEP_MS,
  };
}

/** 一个文本槽位:parent.children[index] 的一段纯文本(含其相邻的 key 列表)。 */
interface TextSlot {
  index: number;
  wordStart: number;
  words: string[];
}

const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style', 'textarea']);

function isKatexSubtree(node: HastElement): boolean {
  const cls = node.properties?.['className'];
  return Array.isArray(cls) && cls.includes('katex');
}

/** LRU 切词缓存:同一段文本(表格列内、列表项内重复文本)不重复 Segmenter。 */
const splitCache = new Map<string, string[]>();
const CACHE_MAX = 500;

function splitWords(text: string): string[] {
  const cached = splitCache.get(text);
  if (cached) {
    splitCache.delete(text);
    splitCache.set(text, cached);
    return cached;
  }
  const words: string[] = [];
  let lastIndex = 0;
  for (const seg of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    if (seg.index > lastIndex) words.push(text.slice(lastIndex, seg.index));
    words.push(seg.segment);
    lastIndex = seg.index + seg.segment.length;
  }
  if (lastIndex < text.length) words.push(text.slice(lastIndex));
  if (splitCache.size >= CACHE_MAX) {
    const firstKey = splitCache.keys().next().value;
    if (firstKey !== undefined) splitCache.delete(firstKey);
  }
  splitCache.set(text, words);
  return words;
}

function keyForWord(keys: string[], wordIndex: number): string {
  const key = keys[wordIndex];
  return key ?? `wf-${wordIndex}`;
}

/** 稳定 key 分配:内容匹配复用旧 key,否则发新 key。 */
function assignKeys(words: string[], state: WordFadeState): string[] {
  const keys: string[] = new Array(words.length);
  const prev = state.previous;
  const usedInPrev = new Set<number>();

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // 同位置内容相等或前缀延续 → 复用。
    if (i < prev.length && (prev[i].content === word || word.startsWith(prev[i].content))) {
      keys[i] = prev[i].key;
      usedInPrev.add(i);
      continue;
    }
    // 错位:按内容从后往前找未被占用的旧 key(结构变化整体平移的词能找回)。
    let found = false;
    for (let j = prev.length - 1; j >= 0; j--) {
      if (!usedInPrev.has(j) && prev[j].content === word) {
        keys[i] = prev[j].key;
        usedInPrev.add(j);
        found = true;
        break;
      }
    }
    if (!found) keys[i] = `wf-${state.nextId++}`;
  }

  // 写回 previous,供下一 tick 匹配。
  state.previous = words.map((content, i) => ({ content, key: keys[i] }));
  return keys;
}

/** 本 tick 的自适应步长:剩余预算 / 本 tick 新词数,封顶 STEP_MS。 */
function planTickStep(newWordCount: number, state: WordFadeState, nowMs: number): void {
  if (newWordCount <= 0) return;
  const backlog = Math.max(state.nextStartAtMs - nowMs, 0);
  const budget = Math.max(MAX_LEAD_MS - backlog, 0);
  state.tickStepMs = Math.min(STEP_MS, budget / newWordCount);
}

/** 给 key 分配绝对开播时刻并返回「开播时刻 - now」(可为负)。 */
function ensureDelay(key: string, state: WordFadeState, nowMs: number): number {
  let startAt = state.startAtByKey.get(key);
  if (startAt === undefined) {
    startAt = Math.min(Math.max(state.nextStartAtMs, nowMs), nowMs + MAX_LEAD_MS);
    state.startAtByKey.set(key, startAt);
    state.nextStartAtMs = startAt + state.tickStepMs;
  }
  return Math.round(startAt - nowMs);
}

function makeWordNode(word: string, key: string, state: WordFadeState, nowMs: number): HastElement {
  const delay = ensureDelay(key, state, nowMs);
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['stream-word'],
      style: `--wf-delay:${delay}ms`,
      dataWfKey: key,
    },
    children: [{ type: 'text', value: word }],
  };
}

function appendPlainText(nodes: HastNode[], text: string): void {
  const last = nodes[nodes.length - 1];
  if (last?.type === 'text') last.value += text;
  else nodes.push({ type: 'text', value: text });
}

function isSlotFullySettled(slot: TextSlot, keys: string[], state: WordFadeState): boolean {
  let wordIndex = slot.wordStart;
  for (const w of slot.words) {
    if (!w.trim()) continue;
    if (!state.settled.has(keyForWord(keys, wordIndex))) return false;
    wordIndex++;
  }
  return true;
}

function makeSlotNodes(
  slot: TextSlot,
  keys: string[],
  state: WordFadeState,
  nowMs: number,
): HastNode[] {
  const nodes: HastNode[] = [];
  let wordIndex = slot.wordStart;
  for (const word of slot.words) {
    if (!word.trim()) {
      appendPlainText(nodes, word);
      continue;
    }
    const key = keyForWord(keys, wordIndex);
    wordIndex++;
    if (state.settled.has(key)) appendPlainText(nodes, word);
    else nodes.push(makeWordNode(word, key, state, nowMs));
  }
  return nodes;
}

/** 应用 list 圆点淡入:li 借用第一个词的 key/delay。 */
function applyMarkerFade(li: HastElement, slot: TextSlot, keys: string[], state: WordFadeState, nowMs: number): void {
  const firstWord = slot.words.find((w) => w.trim());
  if (!firstWord) return;
  const wordIndex = slot.words.indexOf(firstWord);
  const key = keyForWord(keys, slot.wordStart + wordIndex);
  const delay = ensureDelay(key, state, nowMs);
  li.properties['dataStreamMarker'] = '';
  li.properties['dataWfKey'] = key;
  li.properties['style'] = `--wf-delay:${delay}ms`;
}

/**
 * rehype 插件主体:挂进 rehype 链尾,isStreaming 时逐词包 span。
 * 结构元素(标题/列表骨架/表格边框)不占队列位,文本词段与列表圆点淡入。
 */
export const rehypeStreamWordFade: HastTransformer =
  function rehypeStreamWordFade(state) {
    const nowFn = state.nowFn ?? (() => performance.now());
    return (tree: HastElement) => {
      const slots: TextSlot[] = [];
      const markers: Array<{ li: HastElement; slot: TextSlot }> = [];
      let globalWordStart = 0;
      const seenWords: string[] = [];

      const collect = (node: HastElement): void => {
        for (const child of node.children) {
          if (child.type === 'text') {
            slots.push({ index: node.children.indexOf(child), wordStart: globalWordStart, words: splitWords(child.value) });
            for (const w of slots[slots.length - 1].words) seenWords.push(w);
            globalWordStart += slots[slots.length - 1].words.length;
          } else if (child.type === 'element') {
            if (SKIP_TAGS.has(child.tagName) || isKatexSubtree(child)) {
              continue;
            }
            if (child.tagName === 'li') {
              // 记录 li 以借用其第一个词的 key。
              const li = child;
              const liText = collectText(li);
              const liWords = splitWords(liText);
              if (liWords.length > 0) {
                slots.push({ index: -1, wordStart: globalWordStart, words: liWords });
                markers.push({ li, slot: slots[slots.length - 1] });
                globalWordStart += liWords.length;
              }
              continue;
            }
            collect(child);
          }
        }
      };

      const collectText = (node: HastElement): string => {
        let text = '';
        for (const child of node.children) {
          if (child.type === 'text') text += child.value;
          else if (child.type === 'element' && !SKIP_TAGS.has(child.tagName)) text += collectText(child);
        }
        return text;
      };

      const rootEl = tree as unknown as HastElement;
      collect(rootEl);

      const keys = assignKeys(seenWords, state);
      const nowMs = nowFn();
      const newWordCount = keys.filter((k) => !state.startAtByKey.has(k)).length;
      planTickStep(newWordCount, state, nowMs);

      // 从后往前替换文本槽位,前面的 index 不受影响。
      for (let i = slots.length - 1; i >= 0; i--) {
        const slot = slots[i];
        if (slot.index < 0) continue; // li 借用的槽位,不走替换
        if (isSlotFullySettled(slot, keys, state)) continue;
        const parent = findParentOfSlot(tree, slot);
        if (!parent) continue;
        const nodes = makeSlotNodes(slot, keys, state, nowMs);
        (parent as HastElement).children.splice(slot.index, 1, ...nodes);
      }

      for (const { li, slot } of markers) {
        applyMarkerFade(li, slot, keys, state, nowMs);
      }
    };
  };

function findParentOfSlot(tree: HastElement, slot: TextSlot): HastElement | null {
  let found: HastElement | null = null;
  const walk = (node: HastElement): boolean => {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.type === 'text' && node.children.indexOf(child) === slot.index) {
        found = node;
        return true;
      }
      if (child.type === 'element' && walk(child)) return true;
    }
    return false;
  };
  const rootEl = tree as unknown as HastElement;
  walk(rootEl);
  return found;
}

/**
 * MarkdownRenderer 根节点挂在 onAnimationEnd 上,接收冒泡的 animationend:
 * 只认 stream-word-in 动画,把播完词的 key 落袋(settled)。
 */
export function markSettledFromAnimationEnd(
  state: WordFadeState,
  event: { animationName: string; target: EventTarget | null },
): void {
  if (event.animationName !== 'stream-word-in') return;
  const target = event.target as { dataset?: { wfKey?: string } } | null;
  const key = target?.dataset?.wfKey;
  if (key) state.settled.add(key);
}
