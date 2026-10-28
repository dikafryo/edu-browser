/* PEN 브라우저 – 사이드 패널
   위쪽 메뉴(사용 방법·나이스·K-에듀파인·설정) 전환, 업무포털 메뉴로 나이스·K-에듀파인 창 열기,
   결재·공람 점검용 AI 연결, 공문작성 도우미로 공문 작성 요청 넘기기(도우미가 PenGPT를 고르면 대신 묻기)를 맡는다.
   공문 작성 창(크롬 밖 프로그램)에 넣는 일은 짝 프로그램인 공문작성 도우미(gongmun-helper)가 한다. */

/* ===================== 1. 설정 ===================== */
// 열린 탭의 제목·주소에 이 낱말이 있으면 해당 사이트로 알아본다
const SITES = [
  { id: 'portal', name: '업무포털', keywords: ['업무포털', 'eduptl'] },
  { id: 'edufine', name: 'K-에듀파인', keywords: ['에듀파인', 'klef', 'Edufine', 'EDUFINE'] },
  { id: 'pengpt', name: 'PenGPT', keywords: ['PenGPT', 'pengpt', 'PENGPT'] },
];
// 업무포털 위 메뉴(나이스·K-에듀파인)는 로그인 정보를 넘기며 새 창을 연다(SSO). 주소를 직접 열면 로그인이 안 된다
const PORTAL_URL_PATTERN = /eduptl\.kr/;
const PORTAL_LOGIN_PATTERN = /_lgn_|noEpSession/;
const EDUFINE_URL_PATTERN = /klef\.|edufine/i;
const PORTAL_OPEN_TIMEOUT_MS = 40000;
// 메뉴를 누른 뒤 이만큼 새 창이 안 뜨면 팝업이 막힌 것으로 본다
const PORTAL_POPUP_WAIT_MS = 5000;

const TAB_IDS = ['guide', 'neis', 'edufine', 'settings'];
// 나이스 [승인요청] 뒤 상신 화면에서 고를 개인결재선을 복무 종류마다 정한다 (neis.js 의 neisLineKind 가 종류를 정함)
const NEIS_LINE_KINDS = ['연가', '조퇴', '외출', '출장', '종일출장', '연수'];
const PANEL_TAB_KEY = 'panelTab';

const AI_PROVIDERS = ['ollama', 'pengpt'];
const DEFAULT_AI = {
  provider: 'ollama',
  ollamaUrl: '',
  ollamaModel: '',
};

// 같은 PC에서 켜 둔 공문작성 도우미의 연결 통로. 포트를 바꾸면 gongmun/config.py 의 PEN_BRIDGE_PORT 도 같이 바꾼다
const HELPER_URL = 'http://127.0.0.1:47615';
const HELPER_TIMEOUT_MS = 5000;
// 패널을 연 뒤에 도우미를 켜도 상태 표시가 따라오도록 주기적으로 다시 확인한다
const HELPER_CHECK_MS = 15000;
// 도우미가 PenGPT 로 공문 초안을 만들 때, 이 패널이 도우미에 쌓인 질문을 가져가 PenGPT 탭에 대신 묻는다
const HELPER_AI_POLL_MS = 2000;
const HELPER_OFFLINE = '공문작성 도우미가 켜져 있지 않습니다. gongmun-helper 폴더의 실행.bat 을 더블클릭한 뒤 다시 눌러 주세요.';

const PENGPT_SLOTS = [
  { key: 'pengpt.input', label: '질문 입력칸', optional: false },
  { key: 'pengpt.send', label: '보내기 버튼 (비워 두면 Enter로 보냄)', optional: true },
  { key: 'pengpt.answer', label: '대화 내용이 나오는 영역', optional: false },
];
// 위치 지정·진단을 할 사이트 (같은 도메인의 다른 주소·새 창도 포함)
const WORK_SITE_IDS = ['edufine', 'portal', 'pengpt'];

const AI_TIMEOUT_MS = 180000;
// Ollama 기본값(2천~4천 토큰)으로는 긴 결재·공람 화면 글자가 잘리므로 넉넉히 잡는다
const AI_CONTEXT_TOKENS = 16384;

/* ===================== 2. 데이터 처리 ===================== */
const $ = (id) => document.getElementById(id);
let settings = null;

// ---------- 2-1. 저장 ----------
// 예전 판의 공문 작성 설정(기관명·결재선·과제카드·Gemini)은 공문작성 도우미로 옮겨 갔으므로 읽지 않는다
function withDefaults(saved = {}) {
  const savedAi = saved.ai || {};
  return {
    myDuties: saved.myDuties || '',
    neis: neisDefaults(saved.neis),
    slots: { ...(saved.slots || {}) },
    ai: {
      provider: AI_PROVIDERS.includes(savedAi.provider) ? savedAi.provider : DEFAULT_AI.provider,
      ollamaUrl: savedAi.ollamaUrl || DEFAULT_AI.ollamaUrl,
      ollamaModel: savedAi.ollamaModel || DEFAULT_AI.ollamaModel,
    },
  };
}

function uniqueNames(names) {
  return names.map((name) => String(name || '').trim()).filter((name, index, all) => name && all.indexOf(name) === index);
}

// 예전 판은 결재선 하나(lineName)만 있었으므로 모든 종류에 그 결재선을 넣어 이어 쓴다
function neisDefaults(saved = {}) {
  const lines = {};
  NEIS_LINE_KINDS.forEach((kind) => { lines[kind] = (saved.lines || {})[kind] || saved.lineName || ''; });
  return {
    phone: saved.phone || '',
    lineNames: uniqueNames([...(saved.lineNames || []), ...Object.values(lines)]),
    lines,
  };
}

async function loadSettings() {
  const { settings: saved } = await chrome.storage.local.get('settings');
  settings = withDefaults(saved);
}

async function saveSettings() {
  await chrome.storage.local.set({ settings });
}

// ---------- 2-2. 글자 다루기 ----------
function splitLines(text) {
  return (text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function formatToday() {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}. ${get('month')}. ${get('day')}.(${get('weekday')})`;
}

// ---------- 2-3. AI ----------
function trimSlash(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

async function fetchWithTimeout(url, options, offlineMessage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AI 응답이 3분 넘게 오지 않았습니다. 내용을 줄이거나 더 작은 모델을 골라 주세요.');
    }
    throw new Error(offlineMessage);
  } finally {
    clearTimeout(timer);
  }
}

const OLLAMA_OFFLINE = '자체 AI 서버(Ollama)에 연결하지 못했습니다. 서버(맥북)가 켜져 있고 Tailscale이 연결되어 있는지, 설정의 주소가 맞는지 확인해 주세요.';

function ollamaErrorMessage(status) {
  if (status === 403) return '자체 AI 서버(Ollama)가 접속을 막고 있습니다. 설정 > "자체 AI 서버(맥북 Ollama) 준비 방법" 1~2번을 해 주세요.';
  if (status === 404) return '고른 AI 모델이 서버에 없습니다. 설정에서 모델 목록을 다시 불러와 주세요.';
  return `AI 서버가 오류를 알려 왔습니다(번호 ${status}). 잠시 후 다시 시도해 주세요.`;
}

// 주소가 비어 있으면 확장 자신의 주소로 요청이 가 엉뚱한 오류가 나므로 먼저 막는다
function ollamaBaseUrl() {
  const url = trimSlash(settings.ai.ollamaUrl);
  if (!/^https?:\/\//.test(url)) throw new Error('설정 > AI 연결에서 Ollama 주소(http://로 시작)를 먼저 적어 주세요.');
  return url;
}

async function listOllamaModels() {
  const response = await fetchWithTimeout(`${ollamaBaseUrl()}/api/tags`, {}, OLLAMA_OFFLINE);
  if (!response.ok) throw new Error(ollamaErrorMessage(response.status));
  const data = await response.json();
  return [...new Set((data.models || []).map((model) => model.name))];
}

async function callOllama(system, user) {
  const { ollamaModel } = settings.ai;
  const ollamaUrl = ollamaBaseUrl();
  if (!ollamaModel) throw new Error('설정에서 사용할 AI 모델을 먼저 골라 주세요.');
  const body = {
    model: ollamaModel,
    stream: false,
    format: 'json',
    options: { temperature: 0.3, num_ctx: AI_CONTEXT_TOKENS },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  const response = await fetchWithTimeout(`${ollamaUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, OLLAMA_OFFLINE);
  if (!response.ok) throw new Error(ollamaErrorMessage(response.status));
  const data = await response.json();
  return (data.message && data.message.content) || '';
}

async function findSiteTab(siteId) {
  const site = SITES.find((item) => item.id === siteId);
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => matchSite(tab, site)) || null;
}

function findPenGptTab() {
  return findSiteTab('pengpt');
}

// PenGPT는 API가 없어서, 열린 PenGPT 탭 화면에 질문을 넣고 답변 글자를 읽어 온다
async function callPenGpt(system, user) {
  const missing = PENGPT_SLOTS.filter(({ key, optional }) => !optional && !settings.slots[key]).map(({ label }) => label);
  if (missing.length > 0) throw new Error(`설정 > AI 연결 > PenGPT에서 다음 위치를 먼저 지정해 주세요: ${missing.join(', ')}`);
  const tab = await findPenGptTab();
  if (!tab) throw new Error('PenGPT 탭을 찾지 못했습니다. PenGPT에 로그인한 탭을 열어 둔 뒤 다시 눌러 주세요.');
  // 화면에 다시 보이는 내 질문과 AI 답변을 가르는 표시
  const endMark = `(질문 끝 ${Date.now().toString(36)})`;
  const job = {
    kind: 'ask',
    text: `${system}\n\n${user}\n\n${endMark}`,
    endMark,
    timeoutMs: AI_TIMEOUT_MS,
    slots: { input: settings.slots['pengpt.input'], send: settings.slots['pengpt.send'], answer: settings.slots['pengpt.answer'] },
  };
  let frames;
  try {
    frames = await runInFrames(tab.id, (pageJob) => window.__pen.run(pageJob), [job]);
  } catch (error) {
    throw new Error('PenGPT 화면에 질문을 넣지 못했습니다. PenGPT 탭을 새로 고친 뒤 다시 눌러 주세요.');
  }
  const done = frames.map((frame) => frame.result).find((result) => result && result.handled);
  if (!done) throw new Error('PenGPT 화면에서 질문 입력칸을 찾지 못했습니다. 설정에서 입력칸 위치를 다시 지정해 주세요.');
  if (done.problem) throw new Error(done.problem);
  return done.answer;
}

// 공문 내용은 이 둘(자체 AI 서버 Ollama, 교육청 PenGPT)로만 보낸다
function askAi(system, user) {
  if (settings.ai.provider === 'pengpt') return callPenGpt(system, user);
  return callOllama(system, user);
}

function aiName() {
  return settings.ai.provider === 'pengpt' ? 'PenGPT' : '자체 AI 서버';
}

// PenGPT 화면 글자에는 질문 예시 JSON도 섞여 있으므로 맨 마지막 JSON을 답으로 본다
function extractJson(text) {
  const end = text.lastIndexOf('}');
  let start = text.lastIndexOf('{', end);
  while (end >= 0 && start >= 0) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (error) {
      if (start === 0) break;
      start = text.lastIndexOf('{', start - 1);
    }
  }
  return null;
}

// ---------- 2-4. 탭·사이트 ----------
function matchSite(tab, site) {
  const text = `${tab.title || ''} ${tab.url || ''}`;
  return site.keywords.some((word) => text.includes(word));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

/* 업무포털 화면 안에서 실행된다. 위 메뉴에서 글자가 꼭 맞는 링크를 눌러 SSO 로 새 창을 연다.
   팝업 차단으로 창이 안 뜰 때 대신 열 수 있도록 링크의 실제 주소(있으면)도 돌려준다. */
function clickPortalMenu(menuText) {
  const links = Array.from(document.querySelectorAll('a'))
    .filter((link) => link.textContent.trim() === menuText && link.offsetParent !== null);
  if (links.length === 0) return { found: false };
  const href = /^https?:/.test(links[0].href) ? links[0].href : '';
  links[0].click();
  return { found: true, href };
}

// 메뉴가 새 탭으로 열리든 업무포털 탭 자리에서 열리든 받는다
async function waitOpenedTab(urlPattern, knownTabIds, portalTabId, timeoutMs) {
  for (let waited = 0; waited < timeoutMs; waited += 500) {
    const tabs = await chrome.tabs.query({});
    const opened = tabs.find((tab) => (!knownTabIds.has(tab.id) || tab.id === portalTabId)
      && urlPattern.test(tab.url || tab.pendingUrl || ''));
    if (opened) return opened;
    await sleep(500);
  }
  return null;
}

// 로그인한 업무포털 탭. 업무포털 탭이 아예 없으면 undefined, 로그인 화면뿐이면 null
async function findPortalTab() {
  const tabs = await chrome.tabs.query({});
  const portals = tabs.filter((tab) => PORTAL_URL_PATTERN.test(tab.url || ''));
  if (portals.length === 0) return undefined;
  return portals.find((tab) => !PORTAL_LOGIN_PATTERN.test(tab.url)) || null;
}

// 나이스·K-에듀파인 창은 업무포털 메뉴를 눌러 연다. 열린 새 탭을 돌려준다
async function openFromPortal(menuText, urlPattern) {
  const portal = await findPortalTab();
  if (portal === undefined) throw new Error('업무포털 탭을 찾지 못했습니다. 업무포털에 로그인한 뒤 다시 눌러 주세요.');
  if (!portal) throw new Error('업무포털에 로그인되어 있지 않습니다. 업무포털에 로그인한 뒤 다시 눌러 주세요.');
  const knownTabIds = new Set((await chrome.tabs.query({})).map((tab) => tab.id));
  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId: portal.id }, func: clickPortalMenu, args: [menuText] });
  } catch (error) {
    throw new Error('업무포털 화면에 접근하지 못했습니다. 업무포털 탭을 새로 고친 뒤 다시 눌러 주세요.');
  }
  if (!frames[0] || !frames[0].result || !frames[0].result.found) {
    throw new Error(`업무포털 위 메뉴에서 '${menuText}'을(를) 찾지 못했습니다. 업무포털 메인 화면인지 확인해 주세요.`);
  }
  let opened = await waitOpenedTab(urlPattern, knownTabIds, portal.id, PORTAL_POPUP_WAIT_MS);
  const { href } = frames[0].result;
  if (!opened && href) {
    // 확장이 대신 누른 클릭은 크롬이 팝업으로 막을 수 있어, 같은 주소를 새 탭으로 연다(로그인 정보는 같은 크롬이라 이어진다)
    await chrome.tabs.create({ url: href, windowId: portal.windowId, index: portal.index + 1 });
  }
  if (!opened) opened = await waitOpenedTab(urlPattern, knownTabIds, portal.id, PORTAL_OPEN_TIMEOUT_MS);
  if (!opened) {
    throw new Error(`${menuText} 창이 열리지 않았습니다. 크롬 주소창 오른쪽에 '팝업 차단' 표시가 있으면 업무포털의 팝업을 허용한 뒤 다시 눌러 주세요.`);
  }
  return opened;
}

// klef.pen.go.kr 과 edufine.pen.go.kr 처럼 주소 앞부분만 다른 화면도 같은 사이트로 본다
function domainOf(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch (error) { return ''; }
  if (/^[\d.]+$/.test(host)) return host;
  const keep = /\.(go|or|co|ac|re|ne)\.kr$/.test(host) ? 3 : 2;
  return host.split('.').slice(-keep).join('.');
}

// 업무 시스템이 띄운 새 창은 주소가 about:blank 로 시작하기도 해서 함께 받는다
function isScriptable(tab) {
  return /^(https?:|about:blank)/.test(tab.url || '');
}

// 스크립트를 넣을 대상: 새 창(가장 최근 창부터) → 지금 보고 있는 탭 → 업무 사이트 도메인의 모든 탭
// 사이드 패널을 누르면 포커스가 메인 창으로 옮겨 가므로, 새 창은 따로 모두 넣어야 빠지지 않는다
async function findTargetTabs() {
  const workSites = SITES.filter((site) => WORK_SITE_IDS.includes(site.id));
  const domains = new Set((await chrome.tabs.query({}))
    .filter((tab) => workSites.some((site) => matchSite(tab, site)))
    .map((tab) => domainOf(tab.url || '')).filter(Boolean));
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'popup', 'app'] });
  const popupTabs = windows.filter((win) => win.type !== 'normal').sort((a, b) => b.id - a.id).flatMap((win) => win.tabs);
  const siteTabs = windows.filter((win) => win.type === 'normal').flatMap((win) => win.tabs)
    .filter((tab) => domains.has(domainOf(tab.url || '')));
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const ordered = [...popupTabs, ...(active ? [active] : []), ...siteTabs].filter(isScriptable);
  return ordered.filter((tab, index) => ordered.findIndex((other) => other.id === tab.id) === index);
}

async function runInFrames(tabId, func, args) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['filler.js'] });
  return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
}

async function broadcastPicking(slotKey) {
  const tabs = await findTargetTabs();
  for (const tab of tabs) {
    try {
      const func = slotKey ? (key) => window.__pen.startPicking(key) : () => window.__pen.stopPicking();
      await runInFrames(tab.id, func, slotKey ? [slotKey] : []);
    } catch (error) {
      // 스크립트를 넣을 수 없는 탭은 건너뛴다
    }
  }
  return tabs.length;
}

// ---------- 2-5. 공문작성 도우미 (짝 프로그램) ----------
// 공문 작성 창은 크롬 밖 프로그램이라, 같은 PC의 공문작성 도우미가 받아서 넣는다
async function callHelper(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HELPER_TIMEOUT_MS);
  let data;
  try {
    const response = await fetch(`${HELPER_URL}${path}`, { ...options, signal: controller.signal });
    data = await response.json();
  } catch (error) {
    throw new Error(HELPER_OFFLINE);
  } finally {
    clearTimeout(timer);
  }
  if (!data.ok) throw new Error(data.error || '공문작성 도우미가 요청을 받지 못했습니다. 잠시 후 다시 보내 주세요.');
  return data;
}

function postToHelper(path, payload) {
  return callHelper(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function sendToHelper(requestText) {
  return postToHelper('/gongmun', { request: requestText });
}

let helperOnline = false;
let helperAiBusy = false;

// 도우미가 맡긴 일의 종류별 안내 문구와 할 일. edufine_lists 는 inbox.js 의 readEdufineLists 가 맡는다
const HELPER_JOBS = {
  pengpt: {
    busy: '공문작성 도우미의 요청으로 PenGPT에 공문 초안을 묻는 중입니다. PenGPT 탭을 닫지 마세요…',
    done: 'PenGPT 답을 공문작성 도우미로 보냈습니다.',
    failed: 'PenGPT에 묻지 못했습니다',
    run: (job) => callPenGpt(job.system, job.user),
  },
  edufine_lists: {
    busy: '공문작성 도우미의 요청으로 K-에듀파인 탭에서 나의 결재선·과제카드 이름을 읽는 중입니다…',
    done: '나의 결재선·과제카드 이름을 공문작성 도우미로 보냈습니다.',
    failed: 'K-에듀파인 목록을 읽지 못했습니다',
    run: async () => JSON.stringify(await readEdufineLists()),
  },
};

// 도우미가 쌓아 둔 일(PenGPT 질문, K-에듀파인 목록 읽기)을 하나 가져와 하고 결과(또는 실패 이유)를 돌려준다
async function relayHelperAiJob() {
  if (!helperOnline || helperAiBusy) return;
  let job;
  try {
    ({ job } = await postToHelper('/ai/next', {}));
  } catch (error) {
    return;
  }
  if (!job) return;
  // 예전 도우미는 kind 없이 PenGPT 질문만 보낸다
  const task = HELPER_JOBS[job.kind || 'pengpt'];
  if (!task) {
    await postToHelper('/ai/result', { id: job.id, error: 'PEN 브라우저가 모르는 요청입니다. PEN 브라우저를 새 판으로 고쳐 주세요.' }).catch(() => {});
    return;
  }
  helperAiBusy = true;
  showNotice($('helperAiMsg'), 'info', task.busy);
  try {
    const answer = await task.run(job);
    await postToHelper('/ai/result', { id: job.id, answer });
    showNotice($('helperAiMsg'), 'ok', task.done);
  } catch (error) {
    await postToHelper('/ai/result', { id: job.id, error: error.message }).catch(() => {});
    showNotice($('helperAiMsg'), 'error', `${task.failed}: ${error.message}`);
  } finally {
    helperAiBusy = false;
  }
}

/* ===================== 3. 화면 그리기 ===================== */
const NOTICE_MARK = { ok: '✔ ', warn: '! ', error: '✖ ', info: '' };

function showNotice(el, kind, text) {
  el.hidden = !text;
  el.dataset.kind = kind;
  el.textContent = text ? NOTICE_MARK[kind] + text : '';
}

function setPill(pillId, kind, text) {
  const pill = $(pillId);
  pill.dataset.kind = kind;
  pill.textContent = text;
}

function makeButton(text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function fillSelect(selectEl, options, selectedValue) {
  selectEl.replaceChildren(...options.map(({ value, text }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
  }));
  if (options.some((option) => option.value === selectedValue)) selectEl.value = selectedValue;
}

function showTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tab === tabId));
  });
  TAB_IDS.forEach((id) => { $(`tab-${id}`).hidden = id !== tabId; });
  window.scrollTo(0, 0);
}

function makeSlotRow(slotKey, label) {
  const row = document.createElement('div');
  row.className = 'slot-row';
  const name = document.createElement('span');
  name.textContent = label;
  const record = settings.slots[slotKey];
  const state = document.createElement('span');
  state.className = 'slot-state';
  state.dataset.done = String(Boolean(record));
  state.textContent = record ? `✔ 지정됨${record.label ? ` (${record.label})` : ''}` : '아직 지정 안 됨';
  row.append(
    name,
    makeButton('위치 지정', 'btn btn-sub btn-small', () => handleStartPicking(slotKey, label)),
    makeButton('지우기', 'btn btn-sub btn-small', () => handleClearSlot(slotKey)),
    state,
  );
  return row;
}

function renderPenGptSlots() {
  $('penGptSlots').replaceChildren(...PENGPT_SLOTS.map(({ key, label }) => makeSlotRow(key, `PenGPT: ${label}`)));
}

function renderAiSettings() {
  const { ai } = settings;
  document.querySelectorAll('input[name="aiProvider"]').forEach((radio) => { radio.checked = radio.value === ai.provider; });
  $('ollamaBox').hidden = ai.provider !== 'ollama';
  $('penGptBox').hidden = ai.provider !== 'pengpt';
  renderPenGptSlots();
  $('ollamaUrl').value = ai.ollamaUrl;
  if (!$('ollamaModel').options.length && ai.ollamaModel) {
    fillSelect($('ollamaModel'), [{ value: ai.ollamaModel, text: ai.ollamaModel }], ai.ollamaModel);
  }
}

// 복무 종류마다 결재선 고르기 칸을 그린다. 지금 고른 값은 이름 목록이 바뀌어도 유지한다
function renderNeisLineMap(names, chosen) {
  const rows = NEIS_LINE_KINDS.flatMap((kind) => {
    const label = document.createElement('label');
    label.htmlFor = `neisLine-${kind}`;
    label.textContent = kind;
    const select = document.createElement('select');
    select.id = `neisLine-${kind}`;
    select.dataset.lineKind = kind;
    const options = uniqueNames([...names, chosen[kind]]).map((name) => ({ value: name, text: name }));
    fillSelect(select, [{ value: '', text: '(고르지 않음)' }, ...options], chosen[kind] || '');
    return [label, select];
  });
  $('neisLineMap').replaceChildren(...rows);
}

function readNeisLineMap() {
  const chosen = {};
  $('neisLineMap').querySelectorAll('select').forEach((select) => { chosen[select.dataset.lineKind] = select.value; });
  return chosen;
}

function readNeisLineNames() {
  return uniqueNames($('neisLineNames').value.split('\n'));
}

function renderSettingsForm() {
  $('myDuties').value = settings.myDuties;
  $('neisLineNames').value = settings.neis.lineNames.join('\n');
  renderNeisLineMap(settings.neis.lineNames, settings.neis.lines);
  $('neisPhone').value = settings.neis.phone;
  renderAiSettings();
}

/* ===================== 4. 이벤트 연결 ===================== */
// 처리 중에는 버튼을 잠가 두 번 눌리지 않게 한다
async function withBusy(button, busyText, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function handleOpenEdufine() {
  await withBusy($('openEdufineBtn'), '여는 중…', async () => {
    try {
      const existing = await findSiteTab('edufine');
      const tab = existing || await openFromPortal('K-에듀파인', EDUFINE_URL_PATTERN);
      await focusTab(tab);
      showNotice($('inboxMsg'), 'ok', existing ? '열려 있던 K-에듀파인 탭으로 옮겼습니다.' : 'K-에듀파인 창을 열었습니다.');
    } catch (error) {
      showNotice($('inboxMsg'), 'error', error.message);
    }
  });
}

async function handleSelectTab(tabId) {
  showTab(tabId);
  await chrome.storage.local.set({ [PANEL_TAB_KEY]: tabId });
}

// 공문 분석 결과의 [회신 공문 도우미에서 쓰기]도 이 함수를 쓴다
async function handleSendToHelper(requestText) {
  const text = (requestText || '').trim();
  if (!text) {
    showNotice($('helperMsg'), 'warn', '"어떤 공문인가요?" 칸에 내용을 먼저 적어 주세요.');
    $('gongmunRequest').focus();
    return;
  }
  await withBusy($('sendHelperBtn'), '보내는 중…', async () => {
    try {
      await sendToHelper(text);
      setPill('helperStatus', 'ok', '도우미 연결됨');
      showNotice($('helperMsg'), 'ok', '공문작성 도우미로 보냈습니다. 도우미 창에서 내용을 확인하고 [AI로 초안 만들기]를 눌러 주세요.');
    } catch (error) {
      setPill('helperStatus', 'error', '도우미 꺼짐');
      showNotice($('helperMsg'), 'error', error.message);
    }
  });
}

async function checkHelperConnection() {
  try {
    const data = await callHelper('/ping');
    helperOnline = true;
    setPill('helperStatus', 'ok', `도우미 v${data.version}`);
  } catch (error) {
    helperOnline = false;
    setPill('helperStatus', 'error', '도우미 꺼짐');
  }
}

async function handleStartPicking(slotKey, label) {
  const count = await broadcastPicking(slotKey);
  if (count === 0) {
    showNotice($('penGptMsg'), 'warn', 'PenGPT 탭을 찾지 못했습니다. PenGPT를 연 뒤 다시 눌러 주세요.');
    return;
  }
  showNotice($('penGptMsg'), 'info', `PenGPT 화면에서 '${label}'을(를) 한 번 클릭하세요. 취소하려면 Esc를 누르세요.`);
}

async function handlePicked(message) {
  settings.slots[message.slotKey] = message.record;
  await saveSettings();
  await broadcastPicking(null);
  renderPenGptSlots();
  showNotice($('penGptMsg'), 'ok', '위치를 저장했습니다.');
}

async function handleClearSlot(slotKey) {
  delete settings.slots[slotKey];
  await saveSettings();
  renderPenGptSlots();
}

function readSettingsForm() {
  settings.myDuties = $('myDuties').value.trim();
  settings.neis.lineNames = readNeisLineNames();
  settings.neis.lines = readNeisLineMap();
  settings.neis.phone = $('neisPhone').value.trim();
  settings.ai.ollamaUrl = trimSlash($('ollamaUrl').value);
  settings.ai.ollamaModel = $('ollamaModel').value;
}

async function handleSaveSettings() {
  readSettingsForm();
  await saveSettings();
  showNotice($('saveMsg'), 'ok', '설정을 저장했습니다.');
  checkAiConnection();
}

async function handleLoadModels() {
  settings.ai.ollamaUrl = trimSlash($('ollamaUrl').value);
  await withBusy($('loadModelsBtn'), '불러오는 중…', async () => {
    try {
      const models = await listOllamaModels();
      fillSelect($('ollamaModel'), models.map((name) => ({ value: name, text: name })), settings.ai.ollamaModel);
      showNotice($('aiMsg'), 'ok', `모델 ${models.length}개를 찾았습니다. 하나를 고른 뒤 설정 저장을 눌러 주세요.`);
    } catch (error) {
      showNotice($('aiMsg'), 'error', error.message);
    }
  });
}

async function handleTestAi() {
  readSettingsForm();
  await withBusy($('testAiBtn'), '시험 중…', async () => {
    try {
      await askAi('JSON으로만 답한다.', '{"answer":"연결됨"} 을 그대로 출력해.');
      showNotice($('aiMsg'), 'ok', 'AI가 정상적으로 답했습니다.');
      setPill('aiStatus', 'ok', 'AI 연결됨');
    } catch (error) {
      showNotice($('aiMsg'), 'error', error.message);
      setPill('aiStatus', 'error', 'AI 연결 안 됨');
    }
  });
}

async function checkAiConnection() {
  if (settings.ai.provider === 'pengpt') {
    const tab = await findPenGptTab();
    setPill('aiStatus', tab ? 'ok' : 'error', tab ? 'PenGPT 사용' : 'PenGPT 탭 없음');
    return;
  }
  try {
    const models = await listOllamaModels();
    const ready = models.includes(settings.ai.ollamaModel);
    setPill('aiStatus', ready ? 'ok' : 'error', ready ? 'AI 연결됨' : '모델 고르기 필요');
  } catch (error) {
    setPill('aiStatus', 'error', 'AI 연결 안 됨');
  }
}

function bindHelperEvents() {
  $('sendHelperBtn').addEventListener('click', () => handleSendToHelper($('gongmunRequest').value));
  $('openEdufineBtn').addEventListener('click', handleOpenEdufine);
}

function bindTabEvents() {
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', () => handleSelectTab(button.dataset.tab));
  });
}

// 처음 쓰는 사람은 사용 방법부터, 그다음부터는 마지막에 본 메뉴로 연다
async function restoreTab() {
  const { [PANEL_TAB_KEY]: saved } = await chrome.storage.local.get(PANEL_TAB_KEY);
  showTab(TAB_IDS.includes(saved) ? saved : 'guide');
}

function bindSettingsEvents() {
  $('saveSettingsBtn').addEventListener('click', handleSaveSettings);
  $('neisLineNames').addEventListener('input', () => renderNeisLineMap(readNeisLineNames(), readNeisLineMap()));
  $('loadModelsBtn').addEventListener('click', handleLoadModels);
  $('testAiBtn').addEventListener('click', handleTestAi);
  document.querySelectorAll('input[name="aiProvider"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      settings.ai.provider = radio.value;
      renderAiSettings();
    });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'pen-picked') handlePicked(message);
    if (message.type === 'pen-pick-cancel') {
      broadcastPicking(null);
      showNotice($('penGptMsg'), 'info', '위치 지정을 취소했습니다.');
    }
  });
}

async function init() {
  // 옛 판이 실행 중이면 여기서 새 판으로 바뀌고 패널도 다시 열린다(update.js)
  if (await reloadIfUpdated()) return;
  await loadSettings();
  // 예전 판이 이 PC에 남겨 둔 공문 작성 임시본(공문 내용)은 더 쓰지 않으므로 지운다
  chrome.storage.local.remove('draft');
  bindTabEvents();
  await restoreTab();
  renderSettingsForm();
  bindHelperEvents();
  bindSettingsEvents();
  checkAiConnection();
  await checkHelperConnection();
  setInterval(checkHelperConnection, HELPER_CHECK_MS);
  setInterval(relayHelperAiJob, HELPER_AI_POLL_MS);
  window.addEventListener('focus', checkHelperConnection);
}

init();
