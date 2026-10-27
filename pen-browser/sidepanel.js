/* PEN 브라우저 – 사이드 패널
   업무 사이트 전환, 결재·공람 점검용 AI 연결, 공문작성 도우미로 공문 작성 요청 넘기기를 맡는다.
   공문 작성 창(크롬 밖 프로그램)에 넣는 일은 짝 프로그램인 공문작성 도우미(gongmun-helper)가 한다. */

/* ===================== 1. 설정 ===================== */
// 열린 탭의 제목·주소에 이 낱말이 있으면 해당 사이트로 알아본다
const SITES = [
  { id: 'portal', name: '업무포털', keywords: ['업무포털', 'eduptl'] },
  { id: 'neis', name: '나이스', keywords: ['나이스', 'NEIS', 'neis'] },
  { id: 'edufine', name: 'K-에듀파인', keywords: ['에듀파인', 'klef', 'Edufine', 'EDUFINE'] },
  { id: 'edudata', name: '교육행정데이터통합관리', keywords: ['데이터통합', '통합관리', '교육행정데이터'] },
  { id: 'bsss', name: '부산학교지원서비스', keywords: ['BSSS', 'bsss', '학교지원서비스'] },
  { id: 'pengpt', name: 'PenGPT', keywords: ['PenGPT', 'pengpt', 'PENGPT'] },
];

const AI_PROVIDERS = ['ollama', 'pengpt'];
const DEFAULT_AI = {
  provider: 'ollama',
  ollamaUrl: '',
  ollamaModel: '',
};

// 같은 PC에서 켜 둔 공문작성 도우미의 연결 통로. 포트를 바꾸면 gongmun/config.py 의 PEN_BRIDGE_PORT 도 같이 바꾼다
const HELPER_URL = 'http://127.0.0.1:47615';
const HELPER_TIMEOUT_MS = 5000;
const HELPER_OFFLINE = '공문작성 도우미가 켜져 있지 않습니다. gongmun-helper 폴더의 실행.bat 을 더블클릭한 뒤 다시 눌러 주세요.';

const PENGPT_SLOTS = [
  { key: 'pengpt.input', label: '질문 입력칸', optional: false },
  { key: 'pengpt.send', label: '보내기 버튼 (비워 두면 Enter로 보냄)', optional: true },
  { key: 'pengpt.answer', label: '대화 내용이 나오는 영역', optional: false },
];
// 위치 지정·진단을 할 사이트 (같은 도메인의 다른 주소·새 창도 포함)
const WORK_SITE_IDS = ['edufine', 'portal', 'pengpt'];

const PEN_GROUP_TITLE = 'PEN';
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
    siteUrls: { ...(saved.siteUrls || {}) },
    slots: { ...(saved.slots || {}) },
    ai: {
      provider: AI_PROVIDERS.includes(savedAi.provider) ? savedAi.provider : DEFAULT_AI.provider,
      ollamaUrl: savedAi.ollamaUrl || DEFAULT_AI.ollamaUrl,
      ollamaModel: savedAi.ollamaModel || DEFAULT_AI.ollamaModel,
    },
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

const OLLAMA_OFFLINE = '맥북 Ollama에 연결하지 못했습니다. 맥북이 켜져 있고 Tailscale이 연결되어 있는지, 설정의 Ollama 주소가 맞는지 확인해 주세요.';

function ollamaErrorMessage(status) {
  if (status === 403) return '맥북 Ollama가 접속을 막고 있습니다. 설정 > "맥북 Ollama 준비 방법" 1~2번을 해 주세요.';
  if (status === 404) return '고른 AI 모델이 맥북에 없습니다. 설정에서 모델 목록을 다시 불러와 주세요.';
  return `AI 서버가 오류를 알려 왔습니다(번호 ${status}). 잠시 후 다시 시도해 주세요.`;
}

async function listOllamaModels() {
  const response = await fetchWithTimeout(`${trimSlash(settings.ai.ollamaUrl)}/api/tags`, {}, OLLAMA_OFFLINE);
  if (!response.ok) throw new Error(ollamaErrorMessage(response.status));
  const data = await response.json();
  return [...new Set((data.models || []).map((model) => model.name))];
}

async function callOllama(system, user) {
  const { ollamaUrl, ollamaModel } = settings.ai;
  if (!ollamaModel) throw new Error('설정에서 사용할 AI 모델을 먼저 골라 주세요.');
  const body = {
    model: ollamaModel,
    stream: false,
    format: 'json',
    options: { temperature: 0.3, num_ctx: AI_CONTEXT_TOKENS },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  const response = await fetchWithTimeout(`${trimSlash(ollamaUrl)}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, OLLAMA_OFFLINE);
  if (!response.ok) throw new Error(ollamaErrorMessage(response.status));
  const data = await response.json();
  return (data.message && data.message.content) || '';
}

async function findPenGptTab() {
  const remembered = await getTabSafely((await getSiteTabs()).pengpt);
  if (remembered) return remembered;
  const site = SITES.find((item) => item.id === 'pengpt');
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => matchSite(tab, site)) || null;
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

// 공문 내용은 이 둘(내 맥북 Ollama, 교육청 PenGPT)로만 보낸다
function askAi(system, user) {
  if (settings.ai.provider === 'pengpt') return callPenGpt(system, user);
  return callOllama(system, user);
}

function aiName() {
  return settings.ai.provider === 'pengpt' ? 'PenGPT' : '맥북 AI';
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
// 주소의 ? 뒤에는 로그인 정보가 붙는 경우가 있어 저장하지 않는다
function cleanUrl(url) {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}

async function getTabSafely(tabId) {
  if (!tabId) return null;
  try { return await chrome.tabs.get(tabId); } catch (error) { return null; }
}

async function getSiteTabs() {
  const { siteTabs = {} } = await chrome.storage.session.get('siteTabs');
  return siteTabs;
}

async function rememberSiteTab(siteId, tabId) {
  const siteTabs = await getSiteTabs();
  siteTabs[siteId] = tabId;
  await chrome.storage.session.set({ siteTabs });
}

async function addToPenGroup(tab) {
  const groups = await chrome.tabGroups.query({ title: PEN_GROUP_TITLE, windowId: tab.windowId });
  if (groups.length > 0) {
    await chrome.tabs.group({ groupId: groups[0].id, tabIds: [tab.id] });
    return;
  }
  const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(groupId, { title: PEN_GROUP_TITLE, color: 'blue' });
}

// 사이트마다 탭을 하나만 두어, 로그인 상태를 유지한 채 버튼 하나로 오가게 한다
async function openSite(site) {
  const url = settings.siteUrls[site.id];
  if (!url) {
    throw new Error(`'${site.name}' 주소가 아직 없습니다. 그 사이트를 탭에 연 뒤 "지금 열린 탭에서 사이트 주소 찾기"를 눌러 주세요.`);
  }
  const existing = await getTabSafely((await getSiteTabs())[site.id]);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  const currentWindow = await chrome.windows.getCurrent();
  const tab = await chrome.tabs.create({ url, windowId: currentWindow.id, active: true });
  await rememberSiteTab(site.id, tab.id);
  await addToPenGroup(tab);
}

function matchSite(tab, site) {
  const text = `${tab.title || ''} ${tab.url || ''}`;
  return site.keywords.some((word) => text.includes(word));
}

async function detectSitesFromTabs() {
  const tabs = (await chrome.tabs.query({})).filter((tab) => /^https?:/.test(tab.url || ''));
  const found = [];
  for (const site of SITES) {
    const tab = tabs.find((candidate) => matchSite(candidate, site));
    if (!tab) continue;
    settings.siteUrls[site.id] = cleanUrl(tab.url);
    await rememberSiteTab(site.id, tab.id);
    await addToPenGroup(tab);
    found.push(site.name);
  }
  await saveSettings();
  return found;
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
  const domains = new Set(WORK_SITE_IDS.map((id) => domainOf(settings.siteUrls[id] || '')).filter(Boolean));
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

function sendToHelper(requestText) {
  return callHelper('/gongmun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: requestText }),
  });
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

function renderSites() {
  const buttons = SITES.map((site) => {
    const button = makeButton(site.name, 'btn btn-sub', () => handleOpenSite(site));
    button.dataset.missing = String(!settings.siteUrls[site.id]);
    if (!settings.siteUrls[site.id]) button.title = '주소가 아직 등록되지 않았습니다';
    return button;
  });
  $('siteButtons').replaceChildren(...buttons);
}

function renderSiteSettings() {
  const rows = SITES.map((site) => {
    const row = document.createElement('div');
    row.className = 'site-row';
    const label = document.createElement('label');
    label.htmlFor = `site-${site.id}`;
    label.textContent = site.name;
    const input = document.createElement('input');
    input.id = `site-${site.id}`;
    input.value = settings.siteUrls[site.id] || '';
    input.placeholder = 'https://…';
    input.addEventListener('change', () => { settings.siteUrls[site.id] = input.value.trim(); });
    const button = makeButton('지금 탭 주소로', 'btn btn-sub btn-small', () => handleUseCurrentTab(site, input));
    row.append(label, input, button);
    return row;
  });
  $('siteSettings').replaceChildren(...rows);
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

function renderSettingsForm() {
  $('myDuties').value = settings.myDuties;
  renderAiSettings();
  renderSiteSettings();
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

async function handleOpenSite(site) {
  try {
    await openSite(site);
    showNotice($('siteMsg'), 'ok', '');
  } catch (error) {
    showNotice($('siteMsg'), 'warn', error.message);
  }
}

async function handleDetectSites() {
  const found = await detectSitesFromTabs();
  renderSites();
  renderSiteSettings();
  const missing = SITES.filter((site) => !settings.siteUrls[site.id]).map((site) => site.name);
  const text = found.length > 0 ? `찾았습니다: ${found.join(', ')}` : '열린 탭에서 업무 사이트를 찾지 못했습니다.';
  const extra = missing.length > 0 ? `\n아직 주소가 없는 사이트: ${missing.join(', ')} (설정 > 사이트 주소에서 넣어 주세요)` : '';
  showNotice($('siteMsg'), found.length > 0 ? 'ok' : 'warn', text + extra);
}

async function handleUseCurrentTab(site, input) {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active || !/^https?:/.test(active.url || '')) return;
  input.value = cleanUrl(active.url);
  settings.siteUrls[site.id] = input.value;
  await rememberSiteTab(site.id, active.id);
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
    setPill('helperStatus', 'ok', `도우미 v${data.version}`);
  } catch (error) {
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
  settings.ai.ollamaUrl = trimSlash($('ollamaUrl').value);
  settings.ai.ollamaModel = $('ollamaModel').value;
}

async function handleSaveSettings() {
  readSettingsForm();
  await saveSettings();
  renderSites();
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
}

function bindSettingsEvents() {
  $('detectSitesBtn').addEventListener('click', handleDetectSites);
  $('saveSettingsBtn').addEventListener('click', handleSaveSettings);
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
  await loadSettings();
  // 예전 판이 이 PC에 남겨 둔 공문 작성 임시본(공문 내용)은 더 쓰지 않으므로 지운다
  chrome.storage.local.remove('draft');
  renderSites();
  renderSettingsForm();
  bindHelperEvents();
  bindSettingsEvents();
  checkAiConnection();
  checkHelperConnection();
}

init();
