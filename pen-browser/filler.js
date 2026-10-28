/* 교육청 업무도우미 – PenGPT 탭에 질문을 넣고 답변 글자를 읽어 오며, '위치 지정'을 돕는 스크립트.
   (K-에듀파인 공문 작성 창은 크롬 밖 프로그램이라 짝 프로그램 공문작성 도우미가 맡는다.)
   확장 프로그램이 필요할 때만 화면에 넣으며, 화면 내용을 밖으로 보내지 않는다. */
(() => {
  if (window.__pen) return;

  /* ===================== 1. 설정 ===================== */
  const STEP_PAUSE_MS = 500;    // 화면이 입력을 알아챌 틈을 준다
  const ANSWER_POLL_MS = 1000;
  const ANSWER_SETTLE_MS = 4000; // AI 답변 글자가 이 시간 동안 그대로면 답을 다 쓴 것으로 본다
  const HIGHLIGHT_COLOR = '#1d4ed8';

  /* ===================== 2. 요소 다루기 ===================== */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 같은 사이트 안의 여러 프레임을 구분하기 위한 이름 (주소의 ? 뒤는 매번 바뀌므로 뺀다)
  function frameKey() {
    return location.origin + location.pathname;
  }

  // 화면 프레임워크(웹스퀘어 등)가 값 변경을 알아채도록 브라우저 기본 setter와 이벤트를 쓴다
  function fillElement(el, text) {
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    }
    ['input', 'change', 'keyup'].forEach((type) => el.dispatchEvent(new Event(type, { bubbles: true })));
  }

  function pressEnter(el) {
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
  }

  function clickElement(el) {
    el.scrollIntoView({ block: 'center' });
    ['mousedown', 'mouseup'].forEach((type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true })));
    el.click();
  }

  /* ===================== 3. 작업 실행 ===================== */
  function isMyFrame(record) {
    return Boolean(record && record.css) && (!record.frame || record.frame === frameKey());
  }

  // 화면에 다시 보이는 내 질문(끝 표시까지)은 빼고, 그 뒤에 나온 AI 답변만 돌려준다
  function answerPart(now, before, endMark) {
    const markAt = now.lastIndexOf(endMark);
    if (markAt >= 0) return now.slice(markAt + endMark.length);
    return now.startsWith(before) ? now.slice(before.length) : now;
  }

  async function waitForAnswer(job, before) {
    const deadline = Date.now() + job.timeoutMs;
    let last = before;
    let changedAt = Date.now();
    while (Date.now() < deadline) {
      await sleep(ANSWER_POLL_MS);
      const area = document.querySelector(job.slots.answer.css);
      const now = area ? area.innerText : '';
      if (now !== last) {
        last = now;
        changedAt = Date.now();
        continue;
      }
      const answer = answerPart(now, before, job.endMark);
      if (answer.includes('}') && Date.now() - changedAt >= ANSWER_SETTLE_MS) return answer;
    }
    return '';
  }

  async function askChat(job) {
    if (!isMyFrame(job.slots.input)) return { handled: false };
    const input = document.querySelector(job.slots.input.css);
    if (!input) return { handled: false };
    const area = document.querySelector(job.slots.answer.css);
    if (!area) return { handled: true, problem: 'PenGPT 화면에서 대화 영역을 찾지 못했습니다. 설정에서 위치를 다시 지정해 주세요.' };
    const before = area.innerText;
    fillElement(input, job.text);
    await sleep(STEP_PAUSE_MS);
    if (job.slots.send) {
      const sendButton = document.querySelector(job.slots.send.css);
      if (!sendButton) return { handled: true, problem: 'PenGPT 보내기 버튼을 찾지 못했습니다. 설정에서 위치를 다시 지정해 주세요.' };
      clickElement(sendButton);
    } else {
      pressEnter(input);
    }
    const answer = await waitForAnswer(job, before);
    if (!answer) return { handled: true, problem: 'PenGPT 답변이 3분 안에 오지 않았습니다. PenGPT 탭에서 답이 나오는지 확인해 주세요.' };
    return { handled: true, answer };
  }

  async function run(job) {
    if (job.kind === 'ask') return askChat(job);
    return { handled: false };
  }

  /* ===================== 4. 위치 지정 (칸을 한 번 클릭해서 알려주기) ===================== */
  let picking = null;

  // 숫자가 길게 붙은 id는 화면을 열 때마다 바뀌는 경우가 많아 쓰지 않는다
  function isStableId(id) {
    return Boolean(id) && !/\d{5,}/.test(id) && !/^(ext-|gen|ui-id)/.test(id);
  }

  function nthOfType(el) {
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === el.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function buildSelector(el) {
    if (isStableId(el.id)) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (isStableId(node.id)) {
        parts.unshift('#' + CSS.escape(node.id));
        return parts.join(' > ');
      }
      const name = node.getAttribute('name');
      const tag = node.tagName.toLowerCase();
      parts.unshift(name ? `${tag}[name="${CSS.escape(name)}"]` : `${tag}:nth-of-type(${nthOfType(node)})`);
      node = node.parentElement;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  function describe(el) {
    const text = (el.getAttribute('placeholder') || el.getAttribute('title') || el.value || el.textContent || '').trim();
    return text.slice(0, 30);
  }

  function makeHighlight() {
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;border:3px solid ${HIGHLIGHT_COLOR};border-radius:4px;background:rgba(29,78,216,.08);`;
    document.documentElement.appendChild(box);
    return box;
  }

  function moveHighlight(event) {
    const rect = event.target.getBoundingClientRect();
    Object.assign(picking.box.style, {
      left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px',
    });
  }

  // 위치를 고르는 동안에는 업무 화면 버튼이 실제로 눌리지 않도록 막는다
  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handlePickClick(event) {
    blockEvent(event);
    const el = event.target;
    chrome.runtime.sendMessage({
      type: 'pen-picked',
      slotKey: picking.slotKey,
      record: { css: buildSelector(el), frame: frameKey(), label: describe(el) },
    });
    stopPicking();
  }

  function handleKey(event) {
    if (event.key !== 'Escape') return;
    chrome.runtime.sendMessage({ type: 'pen-pick-cancel' });
    stopPicking();
  }

  function startPicking(slotKey) {
    stopPicking();
    picking = { slotKey, box: makeHighlight() };
    window.addEventListener('mousemove', moveHighlight, true);
    window.addEventListener('mousedown', blockEvent, true);
    window.addEventListener('mouseup', blockEvent, true);
    window.addEventListener('click', handlePickClick, true);
    window.addEventListener('keydown', handleKey, true);
  }

  function stopPicking() {
    if (!picking) return;
    picking.box.remove();
    picking = null;
    window.removeEventListener('mousemove', moveHighlight, true);
    window.removeEventListener('mousedown', blockEvent, true);
    window.removeEventListener('mouseup', blockEvent, true);
    window.removeEventListener('click', handlePickClick, true);
    window.removeEventListener('keydown', handleKey, true);
  }

  window.__pen = { run, startPicking, stopPicking };
})();
