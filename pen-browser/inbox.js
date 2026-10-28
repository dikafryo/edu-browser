/* PEN 브라우저 – 결재·공람 점검
   K-에듀파인 결재대기·공람대기 목록은 화면의 표(#tbList)를 그대로 읽는다(AI 가 목록을 짐작하지 않는다).
   공람 중 내가 꼭 볼 문서 고르기와 연 공문 분석만 자체 AI 서버(Ollama) 또는 PenGPT 에 맡긴다.
   공문 분석 결과는 회신 공문 요청으로 공문작성 도우미에 넘길 수 있다.
   (sidepanel.js의 settings·askAi·handleSendToHelper 등을 함께 쓴다) */

/* ===================== 1. 설정 ===================== */
// 화면 글자가 너무 길면 AI가 느려지고 앞부분을 잊으므로 이만큼만 보낸다
const MAX_PAGE_CHARS = 12000;
// '새 문서' 판단용으로 기억해 둘 문서 수 (제목·날짜만 이 PC에 저장)
const SEEN_LIMIT = 500;

const INBOX_COMMON_RULES = [
  '너는 교육청 주무관의 업무 비서다. 사용자는 K-에듀파인 화면에서 읽은 글자를 준다.',
  '메뉴·버튼·안내 문구는 무시하고 문서 목록이나 공문 내용만 본다.',
  '화면에 없는 사실은 지어내지 않는다. 모르는 값은 빈 문자열로 둔다.',
  '날짜는 2026. 10. 27. 처럼 쓴다.',
  '반드시 아래 JSON 하나만 출력한다.',
];

const APPROVAL_PROMPT = [
  ...INBOX_COMMON_RULES,
  '할 일: 화면의 결재할 문서 목록에 있는 문서를 모두 찾고, 문서마다 내가 해야 할 일을 한 줄로 판단한다(예: 결재, 검토 후 결재, 협조 의견 작성).',
  '긴급 표시가 있거나 제목에 긴급·즉시·오늘까지 같은 말이 있으면 urgent를 true로 한다.',
  '{"docs":[{"title":"제목","from":"기안자 또는 기안 부서","date":"기안일","deadline":"처리 기한(화면에 있을 때만)","action":"내가 할 일 한 줄","urgent":false}]}',
].join('\n');

const GONGRAM_PROMPT = [
  ...INBOX_COMMON_RULES,
  '할 일: 화면의 공람 목록에 있는 문서를 모두 찾고, 사용자의 담당 업무를 기준으로 직접 확인해야 하는지 판단한다.',
  '확인 필요(important=true): 담당 업무와 관련된 것, 제출·회신·참석·조치를 요구하는 것, 마감이 있는 것, 전 직원이 꼭 알아야 하는 것.',
  '참고만(important=false): 단순 알림·홍보·행사 안내, 다른 업무 담당자용 문서.',
  '{"docs":[{"title":"제목","from":"보낸 곳","date":"날짜","important":false,"reason":"그렇게 판단한 까닭 한 줄"}]}',
].join('\n');

// 공람은 목록 표에서 읽은 제목·보낸 곳만 AI에 보낸다(공문 본문은 보내지 않는다)
const GONGRAM_PICK_PROMPT = [
  '너는 교육청 주무관의 업무 비서다. 사용자는 공람 문서 목록(번호. 제목 / 보낸 곳)을 준다.',
  '사용자의 담당 업무를 기준으로 문서마다 직접 확인해야 하는지 판단한다.',
  '확인 필요(important=true): 담당 업무와 관련된 것, 제출·회신·참석·조치를 요구하는 것, 마감이 있는 것, 전 직원이 꼭 알아야 하는 것.',
  '참고만(important=false): 단순 알림·홍보·행사 안내, 다른 업무 담당자용 문서.',
  '반드시 아래 JSON 하나만 출력한다. 목록의 모든 번호를 빠짐없이 넣는다.',
  '{"picks":[{"no":1,"important":false,"reason":"그렇게 판단한 까닭 한 줄"}]}',
].join('\n');

const DOC_PROMPT = [
  ...INBOX_COMMON_RULES,
  '할 일: 열려 있는 공문 한 건을 읽고 사용자가 해야 할 일을 정리한다.',
  'deadline은 제출·회신·처리 마감일(시각 포함). 여러 개면 가장 빠른 것.',
  'todo는 사용자가 해야 할 일을 순서대로 짧게 쓴다. 할 일이 없으면 ["참고만 하면 됨"].',
  'important는 사용자의 담당 업무와 관련 있거나 조치가 필요하면 true.',
  '{"title":"제목","from":"보낸 곳","deadline":"","todo":["할 일"],"important":false,"summary":"핵심 내용 3줄 이내"}',
].join('\n');

const INBOX_MODES = {
  approval: {
    name: '결재할 문서',
    prompt: APPROVAL_PROMPT,
    sortKey: 'urgent',
    menuPath: '문서관리 > 결재 > 결재대기',
    notFound: '결재할 문서를 찾지 못했습니다. K-에듀파인의 결재할 문서(긴급) 목록 화면을 앞에 띄웠는지 확인해 주세요.',
  },
  gongram: {
    name: '공람 문서',
    prompt: GONGRAM_PROMPT,
    sortKey: 'important',
    menuPath: '문서관리 > 공람 > 공람대기',
    notFound: '공람 문서를 찾지 못했습니다. K-에듀파인의 공람 목록 화면을 앞에 띄웠는지 확인해 주세요.',
  },
};
// 목록 표의 머리글로 어떤 목록인지 알아본다. 공람대기 표에만 이 머리글이 있다
const GONGRAM_HEADS = ['공람도착일시', '공람지정자'];

/* ===================== 2. 데이터 처리 ===================== */
// 같은 줄이 연달아 나오는 표 머리글·빈 줄을 줄여 AI에 보낼 글자 수를 아낀다
function compactPageText(text) {
  const lines = splitLines(text);
  return lines.filter((line, index) => line !== lines[index - 1]).join('\n');
}

// 공문은 K-에듀파인이 새 창으로 띄우므로, 공문 분석은 가장 최근 새 창을 먼저 읽는다
async function findReadingTab(preferPopup) {
  if (preferPopup) {
    const popups = await chrome.windows.getAll({ populate: true, windowTypes: ['popup', 'app'] });
    const newest = popups.sort((a, b) => b.id - a.id).flatMap((win) => win.tabs).find(isScriptable);
    if (newest) return newest;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active && isScriptable(active) ? active : null;
}

async function readTabText(preferPopup) {
  const tab = await findReadingTab(preferPopup);
  if (!tab) {
    throw new Error('업무 화면 탭을 찾지 못했습니다. K-에듀파인 화면을 앞에 띄운 뒤 다시 눌러 주세요.');
  }
  let frames;
  try {
    // K-에듀파인은 화면 안에 프레임이 여러 겹이라 모든 프레임의 글자를 모은다
    frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => (document.body ? document.body.innerText : ''),
    });
  } catch (error) {
    throw new Error('이 화면의 글자를 읽지 못했습니다. 화면을 새로 고친 뒤 다시 눌러 주세요.');
  }
  const text = compactPageText(frames.map((frame) => frame.result || '').join('\n'));
  if (!text) throw new Error('화면에 읽을 글자가 없습니다. 목록이 다 뜬 뒤 다시 눌러 주세요.');
  return { text: text.slice(0, MAX_PAGE_CHARS), cut: text.length > MAX_PAGE_CHARS };
}

function buildInboxPrompt(pageText) {
  return [
    `오늘 날짜: ${formatToday()}`,
    `내 담당 업무: ${settings.myDuties || '(미입력)'}`,
    '',
    '[화면 글자]',
    pageText,
  ].join('\n');
}

function parseInboxJson(text) {
  const result = extractJson(text);
  if (result) return result;
  throw new Error('AI 답변을 읽지 못했습니다. 한 번 더 눌러 보거나 설정에서 다른 모델을 골라 주세요.');
}

async function askAiAboutPage(system, preferPopup) {
  const page = await readTabText(preferPopup);
  const prompt = buildInboxPrompt(page.text);
  const answer = await askAi(system, prompt);
  return { result: parseInboxJson(answer), cut: page.cut };
}

// ---------- K-에듀파인 목록 표 ----------
// K-에듀파인 화면 안(모든 프레임)에서 실행된다: 목록 표의 머리글과 칸 글자만 읽는다
function readListTableInPage() {
  const table = document.querySelector('#tbList');
  if (!table) return null;
  const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.replace(/\s+/g, ''));
  const rows = Array.from(table.querySelectorAll('tbody tr')).filter((tr) => tr.cells.length === heads.length).map((tr) => {
    const row = {};
    heads.forEach((head, index) => { if (head) row[head] = tr.cells[index].textContent.replace(/\s+/g, ' ').trim(); });
    row.urgentMark = /긴급/.test(tr.textContent) || Array.from(tr.querySelectorAll('img')).some((img) => /긴급/.test(img.alt || img.title || ''));
    return row;
  });
  return { heads: heads.filter(Boolean), rows };
}

// K-에듀파인 맨 위의 결재(긴급)·공람·문서진행·발송대기 건수 (MAIN world 에서 실행)
function readEdufineCountsInPage() {
  try {
    const box = nexacro.getApplication().mainframe.MainVFrameSet.TopFrame.form.divTopGrp.form.divNtzn.form.divNtznDtl.form;
    return ['AAB01', 'AAB02', 'AAB03', 'AAB04']
      .map((id) => (box[id] ? String(box[id].text).replace(/<[^>]*>/g, '').replace(/[|\s]+/g, ' ').trim() : ''))
      .filter(Boolean);
  } catch (error) {
    return null;
  }
}

/* K-에듀파인 화면에 받아 둔 자료(Nexacro 데이터셋)에서 나의 결재선·과제카드 이름만 모은다 (MAIN world 에서 실행).
   과제카드는 공문 작성 창의 과제카드 선택 창과 같은 열 이름(tkcrdNm)을 쓴다.
   문서 목록(제목 열이 있는 표)에도 문서마다 과제카드가 적혀 있어 남의 카드가 섞이므로 그런 표는 건너뛴다 */
function readEdufineListsInPage() {
  if (typeof nexacro === 'undefined' || !nexacro.getApplication) return null;
  const LINE_COLUMN = /(reportCours|sanctnLine|aprvLine|atrzLine|apprLine)\w*Nm$/i;
  const CARD_COLUMN = 'tkcrdNm';
  const DOC_LIST_COLUMN = /^(docSj|sj|docNo|sjNm)$/i;
  const found = { lines: [], cards: [] };
  const seen = new Set();
  const add = (list, value) => {
    const name = String(value || '').trim();
    if (name && !list.includes(name)) list.push(name);
  };
  const readDataset = (dataset) => {
    const columns = Array.from({ length: dataset.getColCount() }, (_, index) => dataset.getColID(index));
    if (columns.some((column) => DOC_LIST_COLUMN.test(column))) return;
    const lineColumn = columns.find((column) => LINE_COLUMN.test(column));
    const hasCards = columns.includes(CARD_COLUMN);
    for (let row = 0; row < dataset.getRowCount(); row += 1) {
      if (lineColumn) add(found.lines, dataset.getColumn(row, lineColumn));
      if (hasCards) add(found.cards, dataset.getColumn(row, CARD_COLUMN));
    }
  };
  const each = (collection, callback) => {
    for (let index = 0; collection && index < collection.length; index += 1) callback(collection[index]);
  };
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 15 || seen.has(node)) return;
    seen.add(node);
    if (typeof node.getColID === 'function' && typeof node.getRowCount === 'function') {
      readDataset(node);
      return;
    }
    ['all', 'objects', 'components', 'frames'].forEach((key) => each(node[key], (child) => visit(child, depth + 1)));
    ['form', 'frame', 'mainframe'].forEach((key) => visit(node[key], depth + 1));
  };
  try {
    const app = nexacro.getApplication();
    visit(app, 0);
    // 프로그램 전체가 함께 쓰는 자료(gds…)는 Application 의 속성으로만 걸려 있다
    Object.keys(app).forEach((key) => visit(app[key], 1));
  } catch (error) {
    // 화면이 바뀌는 중이면 그때까지 모은 것만 돌려준다
  }
  return found;
}

// 공문작성 도우미가 부탁하면 K-에듀파인 탭에서 이름 목록만 읽어 돌려준다(이 PC 안에서만 오간다)
async function readEdufineLists() {
  const tab = await findEdufineTab();
  if (!tab) throw new Error('크롬에서 K-에듀파인 탭을 찾지 못했습니다. 업무포털에서 K-에듀파인을 연 뒤 다시 눌러 주세요.');
  const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', func: readEdufineListsInPage });
  const lists = { lines: [], cards: [] };
  const merge = (list, names) => names.forEach((name) => { if (!list.includes(name)) list.push(name); });
  frames.forEach(({ result }) => {
    if (!result) return;
    merge(lists.lines, result.lines);
    merge(lists.cards, result.cards);
  });
  return lists;
}

async function findEdufineTab() {
  const site = SITES.find((item) => item.id === 'edufine');
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && matchSite(active, site)) return active;
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => matchSite(tab, site)) || null;
}

function tableMode(table) {
  return GONGRAM_HEADS.some((head) => table.heads.includes(head)) ? 'gongram' : 'approval';
}

// 열린 화면 탭마다 표가 남아 있을 수 있어, 고른 점검 종류와 머리글이 맞는 표를 쓴다
async function readListTable(mode) {
  const tab = await findEdufineTab();
  if (!tab) return null;
  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: readListTableInPage });
  } catch (error) {
    return null;
  }
  const tables = frames.map((frame) => frame.result).filter((table) => table && table.heads.includes('제목'));
  return tables.find((table) => tableMode(table) === mode) || null;
}

function rowToDoc(row) {
  return {
    title: row['제목'] || '',
    from: row['기안(발송)부서'] || row['발송기관'] || '',
    person: row['기안(담당)자'] || row['공람지정자'] || '',
    date: row['공람도착일시'] || row['기안일시'] || '',
    kind: row['문서종류'] || '',
    urgent: Boolean(row.urgentMark),
    important: false,
    reason: '',
    action: '',
    deadline: '',
    summary: '',
    todo: [],
  };
}

function buildGongramPickPrompt(docs) {
  return [
    `오늘 날짜: ${formatToday()}`,
    `내 담당 업무: ${settings.myDuties || '(미입력)'}`,
    '',
    '[공람 목록]',
    ...docs.map((doc, index) => `${index + 1}. ${doc.title} / ${doc.from}`),
  ].join('\n');
}

// AI 가 답하지 못하면 모두 '확인 필요'로 두어 놓치는 문서가 없게 한다
async function judgeGongram(docs) {
  try {
    const answer = await askAi(GONGRAM_PICK_PROMPT, buildGongramPickPrompt(docs));
    const picks = parseInboxJson(answer).picks || [];
    docs.forEach((doc, index) => {
      const pick = picks.find((item) => Number(item.no) === index + 1);
      doc.important = pick ? pick.important === true : true;
      doc.reason = pick ? textOf(pick.reason) : 'AI가 판단하지 않은 문서입니다.';
    });
    return '';
  } catch (error) {
    docs.forEach((doc) => { doc.important = true; doc.reason = ''; });
    return `AI가 중요도를 고르지 못해 모두 '확인 필요'로 보여 줍니다. (${error.message})`;
  }
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanDoc(doc) {
  return {
    title: textOf(doc.title),
    from: textOf(doc.from),
    date: textOf(doc.date),
    deadline: textOf(doc.deadline),
    action: textOf(doc.action),
    reason: textOf(doc.reason),
    summary: textOf(doc.summary),
    todo: Array.isArray(doc.todo) ? doc.todo.map(textOf).filter(Boolean) : [],
    urgent: doc.urgent === true,
    important: doc.important === true,
  };
}

// 공문작성 도우미의 ①칸에 그대로 들어가는 글이다
function replyRequestText(doc) {
  return [
    '아래 공문에 대한 회신(보고) 공문을 써 줘.',
    `관련: ${[doc.from, doc.title && `「${doc.title}」`].filter(Boolean).join(' ')}`,
    doc.deadline && `제출 마감: ${doc.deadline}`,
    doc.todo.length > 0 && `요구 사항: ${doc.todo.join(' / ')}`,
  ].filter(Boolean).join('\n');
}

function docKey(doc) {
  return `${doc.title}|${doc.date}`;
}

async function markNewDocs(mode, docs) {
  const { seenDocs = {} } = await chrome.storage.local.get('seenDocs');
  const seen = new Set(seenDocs[mode] || []);
  docs.forEach((doc) => { doc.isNew = !seen.has(docKey(doc)); });
  seenDocs[mode] = [...new Set([...docs.map(docKey), ...seen])].slice(0, SEEN_LIMIT);
  await chrome.storage.local.set({ seenDocs });
}

function sortDocs(docs, key) {
  return docs.sort((a, b) => Number(b[key]) - Number(a[key]) || Number(b.isNew) - Number(a.isNew));
}

/* ===================== 3. 화면 그리기 ===================== */
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

function makeBadge(text, kind) {
  const badge = makeEl('span', 'badge', text);
  badge.dataset.kind = kind;
  return badge;
}

function docBadges(doc, mode) {
  const badges = [];
  if (doc.isNew) badges.push(makeBadge('● 새 문서', 'info'));
  if (mode === 'approval' && doc.urgent) badges.push(makeBadge('! 긴급', 'error'));
  if (mode !== 'approval') badges.push(doc.important ? makeBadge('✔ 확인 필요', 'warn') : makeBadge('참고만', 'idle'));
  return badges;
}

function docKind(doc, mode) {
  if (mode === 'approval') return doc.urgent ? 'urgent' : '';
  return doc.important ? 'important' : '';
}

function docMeta(doc) {
  return [doc.kind, doc.from, doc.person, doc.date, doc.deadline && `마감 ${doc.deadline}`].filter(Boolean).join(' · ');
}

function makeDocItem(doc, mode) {
  const li = makeEl('li', 'doc-item');
  li.dataset.kind = docKind(doc, mode);
  const badges = makeEl('div', 'doc-badges');
  badges.append(...docBadges(doc, mode));
  li.append(badges, makeEl('p', 'doc-title', doc.title || '(제목 없음)'));
  const meta = docMeta(doc);
  if (meta) li.append(makeEl('p', 'doc-meta', meta));
  const note = mode === 'approval' ? doc.action && `할 일: ${doc.action}` : doc.reason;
  if (note) li.append(makeEl('p', 'doc-note', note));
  return li;
}

function inboxSummaryText(mode, docs) {
  const newCount = docs.filter((doc) => doc.isNew).length;
  if (mode === 'approval') {
    const urgent = docs.filter((doc) => doc.urgent).length;
    return `결재할 문서 ${docs.length}건 · 새 문서 ${newCount}건 · 긴급 ${urgent}건`;
  }
  const important = docs.filter((doc) => doc.important).length;
  return `공람 ${docs.length}건 · 확인 필요 ${important}건 · 참고만 ${docs.length - important}건 · 새 문서 ${newCount}건`;
}

// 공람은 확인 필요한 것만 펼쳐 보이고, 참고만 할 것은 접어 둔다
function renderInbox(mode, docs) {
  const main = mode === 'gongram' ? docs.filter((doc) => doc.important) : docs;
  const minor = mode === 'gongram' ? docs.filter((doc) => !doc.important) : [];
  $('inboxEmpty').hidden = true;
  $('inboxSummary').textContent = inboxSummaryText(mode, docs);
  $('inboxList').replaceChildren(...main.map((doc) => makeDocItem(doc, mode)));
  $('inboxMinorList').replaceChildren(...minor.map((doc) => makeDocItem(doc, mode)));
  $('inboxMinorTitle').textContent = `참고만 해도 되는 공람 ${minor.length}건 (펼쳐 보기)`;
  $('inboxMinor').hidden = minor.length === 0;
}

function renderDocAnalysis(doc) {
  const item = makeDocItem(doc, 'doc');
  if (doc.summary) item.append(makeEl('p', 'doc-note', doc.summary));
  const todo = makeEl('ol', 'doc-todo');
  todo.append(...doc.todo.map((step) => makeEl('li', '', step)));
  if (doc.todo.length > 0) item.append(makeEl('p', 'doc-label', '내가 할 일'), todo);
  const requestText = replyRequestText(doc);
  item.append(makeButton('회신 공문 도우미에서 쓰기', 'btn btn-sub btn-small', () => {
    $('gongmunRequest').value = requestText;
    handleSendToHelper(requestText);
  }));
  $('inboxEmpty').hidden = true;
  $('inboxSummary').textContent = '지금 연 공문 분석 결과';
  $('inboxList').replaceChildren(item);
  $('inboxMinor').hidden = true;
}

/* ===================== 4. 이벤트 연결 ===================== */
function cutNotice(cut) {
  return cut ? ' 화면 글자가 많아 앞부분만 읽었습니다.' : '';
}

function renderCounts(counts) {
  $('edufineCounts').hidden = !counts || counts.length === 0;
  $('edufineCounts').textContent = counts ? `K-에듀파인 지금: ${counts.join(' · ')}` : '';
}

async function refreshEdufineCounts() {
  const tab = await findEdufineTab();
  if (!tab) return;
  try {
    const [frame] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: readEdufineCountsInPage });
    renderCounts(frame && frame.result);
  } catch (error) {
    renderCounts(null);
  }
}

// 목록 표를 찾으면 표 그대로 보여 주고, 공람만 AI 가 중요도를 고른다
async function checkFromTable(mode, table) {
  const config = INBOX_MODES[mode];
  const docs = table.rows.map(rowToDoc).filter((doc) => doc.title);
  if (docs.length === 0) {
    renderInbox(mode, []);
    showNotice($('inboxMsg'), 'ok', `${config.name}가 없습니다. (K-에듀파인 ${config.menuPath} 화면 기준)`);
    return;
  }
  let aiProblem = '';
  if (mode === 'gongram') {
    showNotice($('inboxMsg'), 'info', `공람 ${docs.length}건을 읽었습니다. ${aiName()}가 내가 꼭 볼 문서를 고르는 중입니다…`);
    aiProblem = await judgeGongram(docs);
  }
  await markNewDocs(mode, docs);
  renderInbox(mode, sortDocs(docs, config.sortKey));
  if (aiProblem) showNotice($('inboxMsg'), 'warn', aiProblem);
  else showNotice($('inboxMsg'), 'ok', `K-에듀파인 ${config.menuPath} 목록을 그대로 읽었습니다. 목록이 오래됐으면 그 화면에서 [조회]를 누른 뒤 다시 눌러 주세요.`);
}

async function handleCheckList(mode, button) {
  const config = INBOX_MODES[mode];
  await withBusy(button, '처리 중…', async () => {
    try {
      refreshEdufineCounts();
      const table = await readListTable(mode);
      if (table) {
        await checkFromTable(mode, table);
        return;
      }
      // 목록 표가 없는 화면이면 예전처럼 화면 글자를 AI 가 읽는다
      showNotice($('inboxMsg'), 'info', `K-에듀파인 ${config.menuPath} 화면을 찾지 못해 ${aiName()}가 지금 화면 글자를 읽는 중입니다. 30초~1분쯤 걸릴 수 있습니다…`);
      const { result, cut } = await askAiAboutPage(config.prompt, false);
      const docs = (Array.isArray(result.docs) ? result.docs : []).map(cleanDoc).filter((doc) => doc.title);
      if (docs.length === 0) {
        showNotice($('inboxMsg'), 'warn', `${config.notFound} (${config.menuPath} 화면을 열면 더 정확하게 읽습니다.)`);
        return;
      }
      await markNewDocs(mode, docs);
      renderInbox(mode, sortDocs(docs, config.sortKey));
      showNotice($('inboxMsg'), 'ok', `정리를 마쳤습니다. AI 판단이므로 중요한 문서는 직접 열어 확인해 주세요.${cutNotice(cut)}`);
    } catch (error) {
      showNotice($('inboxMsg'), 'error', error.message);
    }
  });
}

async function handleAnalyzeDoc(button) {
  showNotice($('inboxMsg'), 'info', `${aiName()}가 공문을 읽는 중입니다. 30초~1분쯤 걸릴 수 있습니다…`);
  await withBusy(button, '처리 중…', async () => {
    try {
      const { result, cut } = await askAiAboutPage(DOC_PROMPT, true);
      renderDocAnalysis(cleanDoc(result));
      showNotice($('inboxMsg'), 'ok', `분석을 마쳤습니다. 마감일은 공문 원문에서 한 번 더 확인해 주세요.${cutNotice(cut)}`);
    } catch (error) {
      showNotice($('inboxMsg'), 'error', error.message);
    }
  });
}

function initInbox() {
  refreshEdufineCounts();
  $('checkApprovalBtn').addEventListener('click', () => handleCheckList('approval', $('checkApprovalBtn')));
  $('checkGongramBtn').addEventListener('click', () => handleCheckList('gongram', $('checkGongramBtn')));
  $('analyzeDocBtn').addEventListener('click', () => handleAnalyzeDoc($('analyzeDocBtn')));
}

initInbox();
