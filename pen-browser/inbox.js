/* PEN 브라우저 – 결재·공람 점검
   지금 보고 있는 K-에듀파인 화면의 글자를 읽어 맥북 Ollama 또는 PenGPT에 보내고,
   할 일·마감일·중요도를 정리해 보여 준다. 공문 분석 결과는 회신 공문 요청으로 공문작성 도우미에 넘길 수 있다.
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
    notFound: '결재할 문서를 찾지 못했습니다. K-에듀파인의 결재할 문서(긴급) 목록 화면을 앞에 띄웠는지 확인해 주세요.',
  },
  gongram: {
    name: '공람 문서',
    prompt: GONGRAM_PROMPT,
    sortKey: 'important',
    notFound: '공람 문서를 찾지 못했습니다. K-에듀파인의 공람 목록 화면을 앞에 띄웠는지 확인해 주세요.',
  },
};

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
  return [doc.from, doc.date, doc.deadline && `마감 ${doc.deadline}`].filter(Boolean).join(' · ');
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

async function handleCheckList(mode, button) {
  const config = INBOX_MODES[mode];
  showNotice($('inboxMsg'), 'info', `${aiName()}가 ${config.name} 목록을 읽는 중입니다. 30초~1분쯤 걸릴 수 있습니다…`);
  await withBusy(button, '처리 중…', async () => {
    try {
      const { result, cut } = await askAiAboutPage(config.prompt, false);
      const docs = (Array.isArray(result.docs) ? result.docs : []).map(cleanDoc).filter((doc) => doc.title);
      if (docs.length === 0) {
        showNotice($('inboxMsg'), 'warn', config.notFound);
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
  $('checkApprovalBtn').addEventListener('click', () => handleCheckList('approval', $('checkApprovalBtn')));
  $('checkGongramBtn').addEventListener('click', () => handleCheckList('gongram', $('checkGongramBtn')));
  $('analyzeDocBtn').addEventListener('click', () => handleAnalyzeDoc($('analyzeDocBtn')));
}

initInbox();
