/* 교육청 업무도우미 – 문제 진단
   열린 창·탭·프레임 구조와 스크립트 주입 가능 여부를 글로 정리해 보여 준다.
   결과는 화면에만 표시하며, 주소의 ? 뒤(로그인 정보가 붙을 수 있음)는 빼고 적는다. */

/* ===================== 1. 설정 ===================== */
const DIAG_WINDOW_TYPES = ['normal', 'popup', 'app', 'devtools'];
const DIAG_TITLE_LIMIT = 40;

/* ===================== 2. 데이터 처리 ===================== */
function shortUrl(url) {
  if (!url) return '(주소 없음)';
  try {
    const parsed = new URL(url);
    return parsed.protocol.startsWith('http') ? parsed.origin + parsed.pathname : url.slice(0, 30);
  } catch (error) {
    return url.slice(0, 30);
  }
}

// 업무 화면 안에서 실행된다: 그 프레임에 어떤 입력 요소가 있는지만 센다 (내용은 읽지 않음)
function probeFrame() {
  const count = (css) => document.querySelectorAll(css).length;
  return {
    frame: location.origin + location.pathname,
    inputs: count('input:not([type=hidden])'),
    textareas: count('textarea'),
    editables: count('[contenteditable=""],[contenteditable="true"]'),
    frames: count('iframe,frame'),
    canvases: count('canvas'),
    plugins: count('object,embed'),
  };
}

function describeFrame(result) {
  const info = result.result;
  if (!info) return '    · (빈 프레임)';
  return `    · 프레임 ${info.frame}\n      입력칸 ${info.inputs}, 글상자 ${info.textareas}, 편집영역 ${info.editables}, `
    + `내부프레임 ${info.frames}, canvas ${info.canvases}, 플러그인 ${info.plugins}`;
}

async function probeTab(tab) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: probeFrame });
    return results.map(describeFrame);
  } catch (allFramesError) {
    // 모든 프레임 주입이 실패하면 맨 바깥 화면만이라도 되는지 다시 본다
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probeFrame });
      return [`    ! 전체 프레임 주입 실패: ${allFramesError.message}`, ...results.map(describeFrame)];
    } catch (topError) {
      return [`    ✖ 스크립트 주입 불가: ${topError.message}`];
    }
  }
}

// 공문 작성 창은 크롬 밖 프로그램이라 짝 프로그램 공문작성 도우미가 맡는다. 연결 통로가 열려 있는지만 본다.
async function probeHelper() {
  try {
    const data = await callHelper('/ping');
    return `✔ 공문작성 도우미 v${data.version} 연결됨 (${HELPER_URL})`;
  } catch (error) {
    return `✖ ${error.message} (${HELPER_URL})`;
  }
}

async function buildDiagnosis() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: DIAG_WINDOW_TYPES });
  const targetIds = new Set((await findTargetTabs()).map((tab) => tab.id));
  const lines = [
    `교육청 업무도우미 ${chrome.runtime.getManifest().version} 진단 (${new Date().toLocaleString('ko-KR')})`,
    `확장 번호: ${chrome.runtime.id}`,
    `공문작성 도우미: ${await probeHelper()}`,
  ];
  for (const win of windows) {
    lines.push('', `[창 ${win.id} · ${win.type}${win.focused ? ' · 포커스' : ''}]`);
    for (const tab of win.tabs || []) {
      const mark = targetIds.has(tab.id) ? ' ← 위치 지정 대상' : '';
      lines.push(`  - 탭 ${tab.id} "${(tab.title || '').slice(0, DIAG_TITLE_LIMIT)}" ${shortUrl(tab.url)}${mark}`);
      if (targetIds.has(tab.id) || win.type !== 'normal') lines.push(...await probeTab(tab));
    }
  }
  return lines.join('\n');
}

// ---------- NEIS 화면 구조 ----------
// 업무 화면 안에서 실행된다: 칸 이름·종류·버튼 글자만 적고, 칸에 든 값(개인 복무 내용)은 적지 않는다
function probeFormStructure() {
  const LIMIT = 150;
  const clip = (text, size = 30) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, size);
  const visible = (el) => el.getClientRects().length > 0;
  const nameOf = (el) => [el.id && `#${el.id}`, el.name && `[name=${el.name}]`].filter(Boolean).join('') || el.tagName.toLowerCase();
  const labelOf = (el) => {
    const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    return clip((byFor && byFor.textContent) || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder'));
  };
  const lines = [];
  const frameworks = ['WebSquare', 'nexacro', 'Ext', 'jQuery'].filter((key) => typeof window[key] !== 'undefined');
  lines.push(`== ${location.origin + location.pathname} | ${clip(document.title, 40)} | ${frameworks.join(',') || '일반 웹'}`);
  document.querySelectorAll('h1,h2,h3,.title,.tit,[class*="title"]').forEach((el, index) => {
    if (index < 15 && visible(el) && clip(el.textContent)) lines.push(`제목 ${clip(el.textContent, 40)}`);
  });
  const fields = Array.from(document.querySelectorAll('input:not([type=hidden]),select,textarea')).filter(visible);
  fields.slice(0, LIMIT).forEach((el) => {
    const kind = el.tagName === 'SELECT' ? 'select' : (el.type || el.tagName.toLowerCase());
    const options = el.tagName === 'SELECT' ? ` 선택지: ${Array.from(el.options).slice(0, 15).map((opt) => clip(opt.text, 12)).join('/')}` : '';
    lines.push(`칸 ${kind} ${nameOf(el)} "${labelOf(el)}"${options}`);
  });
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button],[onclick]'))
    .filter((el) => visible(el) && clip(el.textContent || el.value));
  buttons.slice(0, LIMIT).forEach((el) => lines.push(`버튼 ${nameOf(el)} "${clip(el.textContent || el.value, 20)}"`));
  lines.push(`(칸 ${fields.length}개, 버튼 ${buttons.length}개)`);
  return lines;
}

/* 나이스 화면 안(MAIN world)에서 실행된다: 4세대 나이스(eXBuilder6)의 열린 화면마다 칸 종류·이름·제목,
   버튼 글자, 목록(콤보)의 선택지, 표의 열 이름만 적는다. 입력칸·표에 든 값(개인 복무 내용)은 적지 않는다 */
function probeNeisApps() {
  if (typeof cpr === 'undefined' || !cpr.core) return [];
  const clip = (text, size = 30) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, size);
  const lines = [];
  cpr.core.Platform.INSTANCE.getAllRunningAppInstances().forEach((app) => {
    lines.push(`== 화면 ${app.app.id}`);
    const walk = (control, depth) => {
      if (!control || depth > 14) return;
      const head = `  ${control.type}:${control.id || '-'}${control.fieldLabel ? ` [${clip(control.fieldLabel)}]` : ''}`;
      if (control.type === 'button' || control.type === 'output') lines.push(`${head} "${clip(control.value, 40)}"`);
      if (control.type === 'combobox' && control.getItems) lines.push(`${head} {${control.getItems().slice(0, 20).map((it) => clip(it.label, 15)).join('/')}}`);
      if (control.type === 'grid' && control.dataSet) lines.push(`${head} 열(${control.dataSet.getRowCount()}행): ${control.dataSet.getColumnNames().slice(0, 30).join(',')}`);
      if (/input|date|check|radio|editor/.test(control.type || '')) lines.push(head);
      if (control.getChildren) control.getChildren().forEach((child) => walk(child, depth + 1));
    };
    walk(app.getContainer(), 0);
  });
  return lines.slice(0, 600);
}

/* K-에듀파인 화면 안(MAIN world)에서 실행된다: 받아 둔 자료(Nexacro 데이터셋)마다 이름·열 이름·행 수만 적는다.
   나의 결재선·과제카드가 어느 자료에 있는지 찾을 때 쓴다. 칸에 든 값(문서 제목 등)은 적지 않는다 */
function probeEdufineDatasets() {
  if (typeof nexacro === 'undefined' || !nexacro.getApplication) return [];
  const lines = [];
  const seen = new Set();
  const each = (collection, callback) => {
    for (let index = 0; collection && index < collection.length; index += 1) callback(collection[index]);
  };
  const visit = (node, depth, path) => {
    if (!node || typeof node !== 'object' || depth > 15 || seen.has(node)) return;
    seen.add(node);
    if (typeof node.getColID === 'function' && typeof node.getRowCount === 'function') {
      const columns = Array.from({ length: node.getColCount() }, (_, index) => node.getColID(index));
      lines.push(`${path}/${node.name || node.id || '?'} (${node.getRowCount()}행): ${columns.slice(0, 25).join(',')}`);
      // 메뉴 자료는 개인 정보가 아니고, 화면을 여는 방법(프로그램 주소)을 찾는 데 필요하므로 행까지 적는다
      if (columns.includes('menuNm')) {
        for (let row = 0; row < Math.min(node.getRowCount(), 200); row += 1) {
          const cell = (column) => (columns.includes(column) ? String(node.getColumn(row, column) || '') : '');
          lines.push(`    메뉴 ${cell('menuId')} | ${cell('menuNm')} | ${cell('progrmId')} | ${cell('progrmCoursAdres')} | 위 ${cell('upperMenuId')}`);
        }
      }
      return;
    }
    const here = node.name ? `${path}/${node.name}` : path;
    // 화면에 직접 정의된 함수 중 메뉴·화면 열기와 관련된 이름만 적는다
    const opens = Object.keys(node).filter((key) => typeof node[key] === 'function' && /menu|open|link|move|go/i.test(key));
    if (opens.length) lines.push(`${here} 함수: ${opens.slice(0, 40).join(', ')}`);
    ['all', 'objects', 'components', 'frames'].forEach((key) => each(node[key], (child) => visit(child, depth + 1, here)));
    ['form', 'frame', 'mainframe'].forEach((key) => visit(node[key], depth + 1, here));
  };
  try {
    const app = nexacro.getApplication();
    visit(app, 0, 'app');
    Object.keys(app).forEach((key) => visit(app[key], 1, 'app'));
  } catch (error) {
    lines.push(`(읽다가 멈춤: ${error.message})`);
  }
  return lines.slice(0, 1200);
}

async function buildEdufineStructure() {
  const tab = await findEdufineTab();
  if (!tab) throw new Error('K-에듀파인 탭을 찾지 못했습니다. K-에듀파인에서 그 화면을 연 뒤 다시 눌러 주세요.');
  const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', func: probeEdufineDatasets });
  const lines = [`K-에듀파인 화면 자료 구조 (${new Date().toLocaleString('ko-KR')})`];
  frames.forEach(({ result }) => lines.push(...(result || [])));
  if (lines.length === 1) lines.push('(읽은 자료가 없습니다)');
  return lines.join('\n');
}

async function buildNeisStructure() {
  const tabs = await chrome.tabs.query({});
  const neisTabs = tabs.filter((tab) => /neis/i.test(tab.url || '') || /나이스|NEIS/.test(tab.title || ''));
  if (neisTabs.length === 0) throw new Error('NEIS 탭을 찾지 못했습니다. NEIS에서 그 화면을 연 뒤 다시 눌러 주세요.');
  const lines = [`NEIS 화면 구조 (${new Date().toLocaleString('ko-KR')})`];
  for (const tab of neisTabs) {
    lines.push('', `[탭 "${(tab.title || '').slice(0, DIAG_TITLE_LIMIT)}" ${shortUrl(tab.url)}]`);
    try {
      // 4세대 나이스는 HTML 칸에 이름이 없으므로 eXBuilder 화면 구조를 읽고, 아니면 일반 웹 구조를 읽는다
      const appFrames = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: probeNeisApps });
      const appLines = (appFrames[0] && appFrames[0].result) || [];
      if (appLines.length) {
        lines.push(...appLines);
        continue;
      }
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: probeFormStructure });
      results.forEach((result) => lines.push(...(result.result || [])));
    } catch (error) {
      lines.push(`✖ 읽지 못함: ${error.message}`);
    }
  }
  return lines.join('\n');
}

/* ===================== 3. 이벤트 연결 ===================== */
async function handleNeisStructure() {
  await withBusy($('neisStructureBtn'), '점검 중…', async () => {
    try {
      $('diagnoseOut').value = await buildNeisStructure();
      $('diagnoseOut').hidden = false;
      $('copyDiagnoseBtn').hidden = false;
      showNotice($('diagnoseMsg'), 'ok', '점검을 마쳤습니다. [결과 복사]를 눌러 개발 담당자에게 전달해 주세요. 칸에 든 값은 적지 않았습니다.');
    } catch (error) {
      showNotice($('diagnoseMsg'), 'error', error.message);
    }
  });
}

async function handleEdufineStructure() {
  await withBusy($('edufineStructureBtn'), '점검 중…', async () => {
    try {
      $('diagnoseOut').value = await buildEdufineStructure();
      $('diagnoseOut').hidden = false;
      $('copyDiagnoseBtn').hidden = false;
      showNotice($('diagnoseMsg'), 'ok', '점검을 마쳤습니다. [결과 복사]를 눌러 개발 담당자에게 전달해 주세요. 자료의 이름과 열 이름만 적었습니다.');
    } catch (error) {
      showNotice($('diagnoseMsg'), 'error', error.message);
    }
  });
}

async function handleDiagnose() {
  await withBusy($('diagnoseBtn'), '점검 중…', async () => {
    try {
      $('diagnoseOut').value = await buildDiagnosis();
      $('diagnoseOut').hidden = false;
      $('copyDiagnoseBtn').hidden = false;
      showNotice($('diagnoseMsg'), 'ok', '점검을 마쳤습니다. [결과 복사]를 눌러 개발 담당자에게 전달해 주세요.');
    } catch (error) {
      showNotice($('diagnoseMsg'), 'error', `점검하지 못했습니다: ${error.message}`);
    }
  });
}

async function handleCopyDiagnosis() {
  try {
    await navigator.clipboard.writeText($('diagnoseOut').value);
    showNotice($('diagnoseMsg'), 'ok', '결과를 복사했습니다. 붙여 넣기(Ctrl+V)로 전달해 주세요.');
  } catch (error) {
    showNotice($('diagnoseMsg'), 'error', '복사하지 못했습니다. 글상자 안을 직접 선택해 복사해 주세요.');
  }
}

$('diagnoseBtn').addEventListener('click', handleDiagnose);
$('neisStructureBtn').addEventListener('click', handleNeisStructure);
$('edufineStructureBtn').addEventListener('click', handleEdufineStructure);
$('copyDiagnoseBtn').addEventListener('click', handleCopyDiagnosis);
