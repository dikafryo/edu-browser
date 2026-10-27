/* PEN 브라우저 – 나이스 복무·출장 입력
   4세대 나이스(eXBuilder6 화면)의 근무상황 신청·출장 신청 창을 열고 입력칸을 채운다.
   [승인요청]은 누르지 않는다 — 사용자가 나이스 화면에서 확인하고 직접 누른다.
   (sidepanel.js의 $, showNotice, withBusy, fillSelect 를 함께 쓴다) */

/* ===================== 1. 설정 ===================== */
// 나이스 근무상황 대분류 → 소분류 → 상세. 2026. 10. 부산 4세대 나이스 화면에서 읽은 목록이다
const LEAVE_TREE = {
  연가: { 연가: [], 반일연가: [], 지각: [], 조퇴: [], 외출: [] },
  병가: {
    병가: [], 반일병가: [], 병지각: [], 병조퇴: [], 병외출: [],
    공무상병가: [], 공무상반일병가: [], 공무상병지각: [], 공무상병조퇴: [], 공무상병외출: [],
  },
  공가: { 공가: [] },
  특별휴가: {
    경조사휴가: ['결혼(본인)', '결혼(자녀)', '배우자출산', '배우자출산(다태아)', '입양(본인)',
      '사망(배우자, 본인 및 배우자의 부모)', '사망(본인 및 배우자의 (외)조부모)', '사망(자녀와 그 자녀의 배우자)',
      '사망(본인 및 배우자의 형제자매와 그 형제자매의 배우자)', '사망(본인 및 배우자 부모의 형제자매와 그 형제자매의 배우자)'],
    출산휴가: ['출산휴가', '출산휴가(미숙아)', '출산휴가(다태아)'],
    난임치료시술휴가: ['인공수정', '체외수정(동결 보존)', '체외수정(난자 채취)'],
    '가족돌봄휴가(유급)': [], '가족돌봄휴가(무급)': [], 육아시간: [], 모성보호시간: [], 수유시간: [],
    여성보건휴가: [], 임신검진휴가: [], 임신검진동행휴가: [], '유산휴가(사산휴가)': [], 자녀군입영휴가: [],
    장기재직휴가: [], 퇴직준비휴가: [], 포상휴가: [], 재해구호휴가: [], 교권침해교원지원휴가: [],
    수업휴가: [], 학습휴가: [], 조리학습휴가: [], 기타특별휴가: [],
  },
  대체휴무: { 초과근무대체휴무: [], 공휴대체휴무: [], 토요대체휴무: [], 일요대체휴무: [], 당직휴무: [], 선거사무휴무: [] },
  연수: { 교육공무원법제41조연수: [] },
  기타: { 기타: [], 근무시간면제: [] },
  결근: { 결근: [], '결근(지각)': [], '결근(조퇴)': [], '결근(외출)': [] },
};
// 연가사유는 나이스 목록 글자가 길어서 앞부분(예: '9호')으로 찾는다
const LEAVE_REASONS = ['휴업일', '1호', '2호', '3호', '4호', '5호', '6호', '7호', '8호', '9호'];
const TRIP_KINDS = ['국내출장(관내)', '국내출장(관외)', '국외출장', '출장(연수)'];
const NEIS_TAB_PATTERN = /neis\.go\.kr/;
const NEIS_DRAFT_KEY = 'neisDraft';

/* ===================== 2. 데이터 처리 ===================== */
function toNeisDate(value) {
  return (value || '').replace(/-/g, '');
}

function splitTime(value) {
  const [hour = '', minute = ''] = (value || '').split(':');
  return { hour, minute };
}

// 나이스는 분을 5분 단위로만 고를 수 있다
function checkTime(value, name) {
  const { minute } = splitTime(value);
  if (!value) return `${name}을(를) 적어 주세요.`;
  if (Number(minute) % 5 !== 0) return `${name}의 분은 5분 단위(00, 05, 10 …)로 적어 주세요.`;
  return '';
}

function checkPeriod(input) {
  if (!input.fromDate || !input.toDate) return '시작일과 종료일을 적어 주세요.';
  const timeProblem = checkTime(input.fromTime, '시작 시각') || checkTime(input.toTime, '종료 시각');
  if (timeProblem) return timeProblem;
  if (`${input.fromDate} ${input.fromTime}` >= `${input.toDate} ${input.toTime}`) return '종료 일시가 시작 일시보다 뒤여야 합니다.';
  return '';
}

function buildLeaveJob(input) {
  const from = splitTime(input.fromTime);
  const to = splitTime(input.toTime);
  return {
    kind: 'leave',
    steps: [
      { type: 'combo', id: 'cmbWorkSittnLclfCd', label: input.major, name: '근무상황 대분류', wait: 900 },
      { type: 'combo', id: 'cmbWorkSittnSclfCd', label: input.minor, name: '근무상황 소분류', wait: 900 },
      { type: 'combo', id: 'cmbWorkSittnDtlCd', label: input.detail, name: '근무상황 상세', optional: true },
      { type: 'combo', id: 'cmbAvRsnCd', label: input.reasonCode, name: '연가사유', optional: true, prefix: true },
      { type: 'date', id: 'dtiWorkYmdFrom', value: toNeisDate(input.fromDate), name: '시작일' },
      { type: 'date', id: 'dtiWorkYmdTo', value: toNeisDate(input.toDate), name: '종료일' },
      { type: 'combo', id: 'cmbBgngH', value: from.hour, name: '시작 시' },
      { type: 'combo', id: 'cmbBgngM', value: from.minute, name: '시작 분' },
      { type: 'combo', id: 'cmbEndH', value: to.hour, name: '종료 시' },
      { type: 'combo', id: 'cmbEndM', value: to.minute, name: '종료 분' },
      { type: 'text', id: 'ipbWorkSittnRsnCn', value: input.reason, name: '사유 또는 용무', optional: true },
      { type: 'text', id: 'ipbDestiNm', value: input.destination, name: '목적지', optional: true },
    ],
  };
}

// 출장 기간은 표 안의 편집칸(dti1·cmb10 …)이라 화면이 신청시간을 다시 계산하도록 그 칸에 넣는다
function buildTripJob(input) {
  const from = splitTime(input.fromTime);
  const to = splitTime(input.toTime);
  return {
    kind: 'trip',
    steps: [
      { type: 'combo', id: 'cmbBsrpScCd', label: input.tripKind, name: '출장종류', wait: 600 },
      { type: 'date', id: 'dti1', value: toNeisDate(input.fromDate), name: '시작일' },
      { type: 'date', id: 'dti2', value: toNeisDate(input.toDate), name: '종료일' },
      { type: 'combo', id: 'cmb10', value: from.hour, name: '시작 시' },
      { type: 'combo', id: 'cmb2', value: from.minute, name: '시작 분' },
      { type: 'combo', id: 'cmb3', value: to.hour, name: '종료 시' },
      { type: 'combo', id: 'cmb4', value: to.minute, name: '종료 분' },
      { type: 'text', id: 'ipbDobtNm', value: input.place, name: '출장지' },
      { type: 'text', id: 'ipbBsrpCn', value: input.purpose, name: '출장목적' },
      { type: 'text', id: 'ipbMvmnMteCn', value: input.movement, name: '이동사항', optional: true },
      { type: 'check', id: 'cbxOfflVhcUtilzYn', value: input.officialCar, name: '공용차량 이용' },
      { type: 'check', id: 'cbxTvctPyrfYn', value: input.noTravelPay, name: '여비 지급 안 함' },
    ],
  };
}

/* 나이스 화면 안(MAIN world)에서 실행된다. 밖의 변수를 쓸 수 없으므로 필요한 것을 모두 안에 둔다.
   화면이 원래 가진 eXBuilder 기능(selectItemByValue, putValue)으로 넣어야 연결된 칸(소분류·신청시간)이 함께 바뀐다. */
async function neisPageRun(job) {
  // ready: 이 목록이 채워져야 신청 창이 처음 자료를 다 받은 것이다. 그 전에 넣으면 화면이 기본값으로 덮어쓴다
  const SCREENS = {
    leave: { menu: '개인근무상황관리', list: 'edu/ga/srv/mym/mm/srv_mymmm00_m00', form: 'edu/ga/srv/mym/mm/srv_mymmm00_p00', ready: 'cmbWorkSittnLclfCd' },
    trip: { menu: '개인출장관리', list: 'edu/ga/srv/mym/mm/srv_mymmm03_m00', form: 'edu/ga/srv/mym/mm/srv_mymmm03_p00', ready: 'cmbBsrpScCd' },
  };
  const ALERT_APP = 'app/cmn/alert';
  const FORM_READY_MS = 15000;
  const SETTLE_MS = 1200;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const squash = (text) => String(text || '').replace(/\s+/g, '');
  if (typeof cpr === 'undefined' || !cpr.core) {
    return { ok: false, problem: '4세대 나이스 화면이 아닙니다. 업무포털에서 나이스를 연 뒤 다시 눌러 주세요.' };
  }
  const platform = cpr.core.Platform.INSTANCE;
  const findApp = (id) => platform.getAllRunningAppInstances().filter((app) => app.app.id === id).pop() || null;
  const waitApp = async (id, ms) => {
    for (let waited = 0; waited < ms; waited += 300) {
      const app = findApp(id);
      if (app) return app;
      await sleep(300);
    }
    return null;
  };
  // 나이스가 띄운 안내창(복무 규정 안내 등)은 글자를 모아 사용자에게 보여 주고 닫는다
  const collectNotices = async () => {
    const notices = [];
    for (let count = 0; count < 10; count += 1) {
      const alertApp = findApp(ALERT_APP);
      if (!alertApp) break;
      const texts = [];
      const walk = (control, depth) => {
        if (!control || depth > 10) return;
        if (control.type === 'output' && control.value) texts.push(String(control.value).trim());
        if (control.getChildren) control.getChildren().forEach((child) => walk(child, depth + 1));
      };
      walk(alertApp.getContainer(), 0);
      notices.push(texts.join('\n'));
      const confirm = alertApp.lookup('btnConfirm');
      if (!confirm) break;
      confirm.click();
      await sleep(500);
    }
    return notices.filter(Boolean);
  };

  const screen = SCREENS[job.kind];
  let form = findApp(screen.form);
  if (!form) {
    let list = findApp(screen.list);
    if (!list) {
      const link = Array.from(document.querySelectorAll('a')).find((a) => a.textContent.trim().startsWith(screen.menu));
      if (!link) return { ok: false, problem: `나이스 왼쪽 메뉴에서 '${screen.menu}'을(를) 찾지 못했습니다. 복무 메뉴에서 그 화면을 한 번 연 뒤 다시 눌러 주세요.` };
      link.click();
      list = await waitApp(screen.list, 10000);
    }
    if (!list) return { ok: false, problem: `'${screen.menu}' 화면이 열리지 않았습니다. 나이스 화면이 다 뜬 뒤 다시 눌러 주세요.` };
    const applyButton = list.lookup('btnAply');
    if (!applyButton) return { ok: false, problem: `'${screen.menu}' 화면에서 [신청] 버튼을 찾지 못했습니다.` };
    applyButton.click();
    form = await waitApp(screen.form, 12000);
  }
  if (!form) return { ok: false, problem: '신청 창이 열리지 않았습니다. 나이스에 안내창이 떠 있는지 확인한 뒤 다시 눌러 주세요.', notices: await collectNotices() };
  const isReady = () => {
    const probe = form.lookup(screen.ready);
    const grid = form.lookup('grdMain');
    return probe && probe.getItems().length > 1 && grid && grid.dataSet && grid.dataSet.getRowCount() > 0;
  };
  for (let waited = 0; waited < FORM_READY_MS && !isReady(); waited += 300) await sleep(300);
  if (!isReady()) return { ok: false, problem: '신청 창이 자료를 다 받지 못했습니다. 잠시 뒤 다시 눌러 주세요.', notices: await collectNotices() };
  await sleep(SETTLE_MS);

  const results = [];
  const placed = [];
  for (const step of job.steps) {
    const wanted = step.value !== undefined ? step.value : step.label;
    if (wanted === undefined || wanted === '' || wanted === null) {
      if (!step.optional && step.type !== 'check') results.push({ name: step.name, ok: false, problem: '값이 비어 있습니다.' });
      continue;
    }
    const control = form.lookup(step.id);
    if (!control) {
      if (!step.optional) results.push({ name: step.name, ok: false, problem: '나이스 화면에서 이 칸을 찾지 못했습니다.' });
      continue;
    }
    try {
      if (step.type === 'combo') {
        const items = control.getItems();
        const item = step.label !== undefined
          ? items.find((it) => (step.prefix ? squash(it.label).startsWith(squash(step.label)) : squash(it.label) === squash(step.label)))
          : items.find((it) => it.value === step.value || it.label === step.value);
        if (!item) {
          if (step.optional && items.length === 0) continue;
          results.push({ name: step.name, ok: false, problem: `'${wanted}'이(가) 목록에 없습니다. 나이스에서 직접 골라 주세요.` });
          continue;
        }
        control.selectItemByValue(item.value);
        results.push({ name: `${step.name}: ${item.label}`, ok: true });
        placed.push({ control, expect: item.value, result: results[results.length - 1] });
      } else if (step.type === 'check') {
        control.checked = Boolean(step.value);
        if (step.value) results.push({ name: step.name, ok: true });
      } else {
        control.putValue(String(wanted));
        results.push({ name: `${step.name}: ${String(wanted).slice(0, 30)}`, ok: true });
        placed.push({ control, expect: String(wanted), result: results[results.length - 1] });
      }
    } catch (error) {
      results.push({ name: step.name, ok: false, problem: '넣다가 문제가 생겼습니다. 직접 입력해 주세요.' });
    }
    await sleep(step.wait || 250);
  }
  await sleep(SETTLE_MS);
  // 화면이 뒤늦게 기본값으로 되돌린 칸이 있으면 성공으로 보고하지 않는다
  placed.forEach(({ control, expect, result }) => {
    if (String(control.value) !== expect) {
      result.ok = false;
      result.problem = '나이스 화면이 값을 되돌렸습니다. 이 칸은 직접 고쳐 주세요.';
    }
  });
  return { ok: true, results, notices: await collectNotices() };
}

async function findNeisTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => NEIS_TAB_PATTERN.test(tab.url || '')) || null;
}

async function runNeisJob(job) {
  const tab = await findNeisTab();
  if (!tab) throw new Error('나이스 탭을 찾지 못했습니다. 업무포털에서 [나이스]를 눌러 연 뒤 다시 눌러 주세요.');
  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: neisPageRun, args: [job] });
  } catch (error) {
    throw new Error('나이스 화면에 접근하지 못했습니다. 나이스 탭을 새로 고친 뒤 다시 눌러 주세요.');
  }
  const reply = frames[0] && frames[0].result;
  if (!reply) throw new Error('나이스 화면이 답하지 않았습니다. 나이스 탭을 새로 고친 뒤 다시 눌러 주세요.');
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return reply;
}

/* ===================== 3. 화면 그리기 ===================== */
function optionList(values, placeholder) {
  const options = values.map((value) => ({ value, text: value }));
  return placeholder ? [{ value: '', text: placeholder }, ...options] : options;
}

function renderLeaveMinor() {
  const minors = Object.keys(LEAVE_TREE[$('neisMajor').value] || {});
  fillSelect($('neisMinor'), optionList(minors), $('neisMinor').value);
  renderLeaveDetail();
}

function renderLeaveDetail() {
  const details = (LEAVE_TREE[$('neisMajor').value] || {})[$('neisMinor').value] || [];
  fillSelect($('neisDetail'), optionList(details, '(고르기)'), $('neisDetail').value);
  $('neisDetailBox').hidden = details.length === 0;
  $('neisReasonCodeBox').hidden = $('neisMajor').value !== '연가';
}

function showNeisKind(kind) {
  $('neisLeaveBox').hidden = kind !== 'leave';
  $('neisLeaveText').hidden = kind !== 'leave';
  $('neisTripBox').hidden = kind !== 'trip';
  $('neisTripText').hidden = kind !== 'trip';
  document.querySelectorAll('input[name="neisKind"]').forEach((radio) => { radio.checked = radio.value === kind; });
}

function renderNeisResult(reply) {
  const items = (reply.results || []).map(({ name, ok, problem }) => {
    const li = document.createElement('li');
    li.dataset.kind = ok ? 'ok' : 'error';
    li.textContent = ok ? `✔ ${name}` : `✖ ${name} – ${problem}`;
    return li;
  });
  (reply.notices || []).forEach((text) => {
    const li = document.createElement('li');
    li.dataset.kind = 'info';
    li.textContent = `나이스 안내: ${text}`;
    items.push(li);
  });
  $('neisLog').replaceChildren(...items);
}

/* ===================== 4. 이벤트 연결 ===================== */
const NEIS_FIELD_IDS = ['neisMajor', 'neisMinor', 'neisDetail', 'neisReasonCode', 'neisFromDate', 'neisFromTime',
  'neisToDate', 'neisToTime', 'neisReason', 'neisDestination', 'tripKind', 'tripPlace', 'tripPurpose', 'tripMovement'];

function readNeisInput() {
  const value = (id) => $(id).value.trim();
  return {
    kind: document.querySelector('input[name="neisKind"]:checked').value,
    major: value('neisMajor'), minor: value('neisMinor'), detail: value('neisDetail'), reasonCode: value('neisReasonCode'),
    fromDate: value('neisFromDate'), fromTime: value('neisFromTime'), toDate: value('neisToDate'), toTime: value('neisToTime'),
    reason: value('neisReason'), destination: value('neisDestination'),
    tripKind: value('tripKind'), place: value('tripPlace'), purpose: value('tripPurpose'), movement: value('tripMovement'),
    officialCar: $('tripOfficialCar').checked, noTravelPay: $('tripNoPay').checked,
  };
}

function checkNeisInput(input) {
  const periodProblem = checkPeriod(input);
  if (periodProblem) return periodProblem;
  if (input.kind === 'trip' && (!input.place || !input.purpose)) return '출장지와 출장목적을 적어 주세요.';
  if (input.kind === 'leave' && !input.minor) return '근무상황을 골라 주세요.';
  return '';
}

// 자주 쓰는 출장지·사유를 다음에 다시 쓰도록 이 PC 안(브라우저 저장소)에만 남긴다
function saveNeisDraft() {
  const draft = { kind: document.querySelector('input[name="neisKind"]:checked').value };
  NEIS_FIELD_IDS.forEach((id) => { draft[id] = $(id).value; });
  draft.tripOfficialCar = $('tripOfficialCar').checked;
  draft.tripNoPay = $('tripNoPay').checked;
  chrome.storage.local.set({ [NEIS_DRAFT_KEY]: draft });
}

async function handleNeisFill() {
  const input = readNeisInput();
  const problem = checkNeisInput(input);
  if (problem) {
    showNotice($('neisMsg'), 'warn', problem);
    return;
  }
  saveNeisDraft();
  const job = input.kind === 'trip' ? buildTripJob(input) : buildLeaveJob(input);
  showNotice($('neisMsg'), 'info', '나이스 신청 창을 열고 넣는 중입니다. 나이스 화면을 건드리지 말고 기다려 주세요…');
  $('neisLog').replaceChildren();
  await withBusy($('neisFillBtn'), '처리 중…', async () => {
    try {
      const reply = await runNeisJob(job);
      if (!reply.ok) {
        showNotice($('neisMsg'), 'error', reply.problem);
        renderNeisResult(reply);
        return;
      }
      const failed = reply.results.filter((result) => !result.ok).length;
      showNotice($('neisMsg'), failed ? 'warn' : 'ok', failed
        ? `${failed}칸을 넣지 못했습니다. 아래를 보고 나이스에서 직접 채운 뒤 [승인요청]을 눌러 주세요.`
        : '입력을 마쳤습니다. 나이스 화면에서 내용을 확인한 뒤 직접 [승인요청]을 눌러 주세요.');
      renderNeisResult(reply);
    } catch (error) {
      showNotice($('neisMsg'), 'error', error.message);
    }
  });
}

// 날짜 입력칸 형식(YYYY-MM-DD)의 한국 날짜. en-CA 형식이 마침 그 모양이다
function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function restoreNeisDraft() {
  const { [NEIS_DRAFT_KEY]: draft = {} } = await chrome.storage.local.get(NEIS_DRAFT_KEY);
  fillSelect($('neisMajor'), optionList(Object.keys(LEAVE_TREE)), draft.neisMajor || '연가');
  renderLeaveMinor();
  if (draft.neisMinor) $('neisMinor').value = draft.neisMinor;
  renderLeaveDetail();
  fillSelect($('neisReasonCode'), optionList(LEAVE_REASONS, '(고르지 않음)'), draft.neisReasonCode || '');
  fillSelect($('tripKind'), optionList(TRIP_KINDS), draft.tripKind || TRIP_KINDS[0]);
  ['neisReason', 'neisDestination', 'tripPlace', 'tripPurpose', 'tripMovement', 'neisFromTime', 'neisToTime'].forEach((id) => {
    if (draft[id]) $(id).value = draft[id];
  });
  // 날짜는 지난 값을 되살리지 않고 오늘로 시작한다
  $('neisFromDate').value = todayInputValue();
  $('neisToDate').value = todayInputValue();
  $('tripOfficialCar').checked = Boolean(draft.tripOfficialCar);
  $('tripNoPay').checked = Boolean(draft.tripNoPay);
  showNeisKind(draft.kind === 'trip' ? 'trip' : 'leave');
}

function initNeis() {
  restoreNeisDraft();
  $('neisMajor').addEventListener('change', renderLeaveMinor);
  $('neisMinor').addEventListener('change', renderLeaveDetail);
  document.querySelectorAll('input[name="neisKind"]').forEach((radio) => {
    radio.addEventListener('change', () => showNeisKind(radio.value));
  });
  $('neisFillBtn').addEventListener('click', handleNeisFill);
}

initNeis();
