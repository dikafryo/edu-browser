// 패널 스크립트 기능 시험 — 결과를 #testOut 에 적는다
(async () => {
  const out = [];
  const check = (name, cond, detail) => out.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + JSON.stringify(detail)));
  await new Promise((r) => setTimeout(r, 400)); // init() 비동기 작업이 끝나길 기다린다

  // 1. 나이스: 화면 초기화
  check('neis major options', $('neisMajor').options.length === Object.keys(LEAVE_TREE).length, $('neisMajor').options.length);
  check('neis minor for 연가', Array.from($('neisMinor').options).map((o) => o.value).join('/') === '연가/반일연가/지각/조퇴/외출', Array.from($('neisMinor').options).map((o) => o.value));
  check('dates default today', /^\d{4}-\d{2}-\d{2}$/.test($('neisFromDate').value), $('neisFromDate').value);
  check('leave box shown, trip hidden', !$('neisLeaveBox').hidden && $('neisTripBox').hidden && $('neisTripText').hidden, null);

  // 2. 대분류를 바꾸면 소분류·상세가 따라 바뀐다
  $('neisMajor').value = '특별휴가'; $('neisMajor').dispatchEvent(new Event('change'));
  $('neisMinor').value = '경조사휴가'; $('neisMinor').dispatchEvent(new Event('change'));
  check('detail shown for 경조사휴가', !$('neisDetailBox').hidden && $('neisDetail').options.length > 5, $('neisDetail').options.length);
  check('reason code hidden when not 연가', $('neisReasonCodeBox').hidden, null);
  $('neisMajor').value = '연가'; $('neisMajor').dispatchEvent(new Event('change'));
  check('detail hidden for 연가', $('neisDetailBox').hidden && !$('neisReasonCodeBox').hidden, null);

  // 3. 출장 전환
  document.querySelector('input[name="neisKind"][value="trip"]').click();
  check('trip box shown', !$('neisTripBox').hidden && !$('neisTripText').hidden && $('neisLeaveText').hidden, null);
  check('trip kinds', $('tripKind').options.length === 4, $('tripKind').options.length);
  document.querySelector('input[name="neisKind"][value="leave"]').click();

  // 4. 입력 검사
  const base = { kind: 'leave', minor: '외출', fromDate: '2026-12-30', toDate: '2026-12-30', fromTime: '14:00', toTime: '16:00' };
  check('valid leave', checkNeisInput(base) === '', checkNeisInput(base));
  check('minute not 5-step', /5분 단위/.test(checkNeisInput({ ...base, fromTime: '14:03' })), checkNeisInput({ ...base, fromTime: '14:03' }));
  check('end before start', /뒤여야/.test(checkNeisInput({ ...base, toTime: '13:00' })), null);
  check('missing date', /시작일과 종료일/.test(checkNeisInput({ ...base, toDate: '' })), null);
  check('trip needs place', /출장지/.test(checkNeisInput({ ...base, kind: 'trip', place: '', purpose: 'x' })), null);

  // 5. 작업 만들기 (나이스 칸 ID·값)
  const leaveJob = buildLeaveJob({ ...base, major: '연가', detail: '', reasonCode: '9호', reason: '병원', destination: '' });
  const ids = Object.fromEntries(leaveJob.steps.map((s) => [s.id, s.value !== undefined ? s.value : s.label]));
  check('leave job values', ids.dtiWorkYmdFrom === '20261230' && ids.cmbBgngH === '14' && ids.cmbBgngM === '00' && ids.cmbEndH === '16' && ids.cmbAvRsnCd === '9호' && ids.cmbWorkSittnSclfCd === '외출', ids);
  const tripJob = buildTripJob({ ...base, kind: 'trip', tripKind: '국내출장(관외)', place: '서울', purpose: '연수', movement: '', officialCar: true, noTravelPay: false });
  const tids = Object.fromEntries(tripJob.steps.map((s) => [s.id, s.value !== undefined ? s.value : s.label]));
  check('trip job values', tids.dti1 === '20261230' && tids.cmb10 === '14' && tids.cmb3 === '16' && tids.cmbBsrpScCd === '국내출장(관외)' && tids.cbxOfflVhcUtilzYn === true, tids);
  check('neisPageRun is self-contained', !/\bsettings\b|\$\(|chrome\./.test(neisPageRun.toString()), null);

  // 6. 결재·공람 표 읽기
  const box = document.createElement('div');
  box.innerHTML = '<table id="tbList"><thead><tr><th></th><th>상태</th><th>문서종류</th><th>문서번호</th><th>제목</th><th>발송기관</th><th>공람지정자</th><th>공람지정부서</th><th>기안일시</th><th>공람도착일시</th><th>처리유형</th></tr></thead>'
    + '<tbody><tr><td></td><td>미처리</td><td>수신</td><td>가-1</td><td>[긴급] 자료 제출</td><td>교육청</td><td>홍길동</td><td>과</td><td>2026-10-27</td><td>2026-10-27 17:00</td><td>공람</td></tr></tbody></table>';
  document.body.append(box);
  const table = readListTableInPage();
  check('table parsed', table.rows.length === 1 && table.rows[0]['제목'] === '[긴급] 자료 제출', table);
  check('table mode gongram', tableMode(table) === 'gongram', table.heads);
  const doc = rowToDoc(table.rows[0]);
  check('row to doc', doc.from === '교육청' && doc.person === '홍길동' && doc.date === '2026-10-27 17:00' && doc.urgent === true, doc);
  check('approval mode by heads', tableMode({ heads: ['상태', '제목', '기안(발송)부서'] }) === 'approval', null);
  box.querySelector('tbody').innerHTML = '<tr><td colspan="11">조회 결과가 없습니다.</td></tr>';
  check('empty list -> no rows', readListTableInPage().rows.length === 0, null);
  box.remove();

  // 7. 공람 판단 프롬프트, 회신 요청 글
  const prompt = buildGongramPickPrompt([doc]);
  check('gongram prompt has numbered titles only', /1\. \[긴급\] 자료 제출 \/ 교육청/.test(prompt), prompt);
  const reply = replyRequestText({ from: '교육청', title: '자료 제출', deadline: '11. 3.', todo: ['자료 작성', '제출'] });
  check('reply request text', reply.includes('관련: 교육청 「자료 제출」') && reply.includes('제출 마감: 11. 3.') && reply.split('\n').length === 4, reply);

  // 8. 새 판 반영 (update.js)
  const realFetch = window.fetch;
  window.fetch = async () => ({ json: async () => ({ version: 'test' }) });
  check('same version -> no reload', (await reloadIfUpdated()) === false && !window.__reloaded, null);
  window.fetch = async () => ({ json: async () => ({ version: 'newer' }) });
  check('newer folder version -> reload', (await reloadIfUpdated()) === true && window.__reloaded === true, null);
  window.fetch = async () => { throw new Error('reading'); };
  window.__reloaded = false;
  check('unreadable manifest -> keep running', (await reloadIfUpdated()) === false && !window.__reloaded, null);
  window.fetch = realFetch;

  // 9. 위쪽 메뉴 4개
  const visibleTabs = () => TAB_IDS.filter((id) => !$(`tab-${id}`).hidden);
  check('first open shows guide only', visibleTabs().join() === 'guide', visibleTabs());
  document.querySelector('.tab-btn[data-tab="neis"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check('neis tab selected', visibleTabs().join() === 'neis' && document.querySelector('.tab-btn[data-tab="neis"]').getAttribute('aria-selected') === 'true', visibleTabs());
  const savedTab = await chrome.storage.local.get(PANEL_TAB_KEY);
  check('tab remembered', savedTab[PANEL_TAB_KEY] === 'neis', savedTab);
  check('four menu buttons', Array.from(document.querySelectorAll('.tab-btn')).map((b) => b.textContent).join('/') === '사용 방법/나이스/K-에듀파인/설정', null);
  check('site settings removed', !document.getElementById('siteButtons') && !document.getElementById('siteSettings') && typeof openSite === 'undefined', null);

  // 10. 24시간제 시각
  check('24 hours, 5-minute steps', $('neisFromHour').options.length === 24 && $('neisFromHour').options[23].value === '23' && $('neisFromMinute').options.length === 12, null);
  check('default times', readTime('neisFrom') === '09:00' && readTime('neisTo') === '18:00', [readTime('neisFrom'), readTime('neisTo')]);
  $('neisFromHour').value = '14'; $('neisFromMinute').value = '30';
  check('read 24h time', readNeisInput().fromTime === '14:30', readNeisInput().fromTime);

  // 11. 업무포털 메뉴 누르기 (업무포털 화면 안에서 도는 함수)
  const menu = document.createElement('div');
  let clicked = '';
  menu.innerHTML = '<a href="#">나이스 FAQ</a><a href="#"> 나이스 </a><a href="#">K-에듀파인</a>';
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); clicked = a.textContent.trim(); }));
  document.body.append(menu);
  check('portal menu exact match', clickPortalMenu('나이스').found === true && clicked === '나이스', clicked);
  check('portal menu missing', clickPortalMenu('없는메뉴').found === false, null);
  menu.remove();
  check('portal tab missing -> clear message', await openFromPortal('나이스', /neis/).then(() => false, (e) => /업무포털 탭을 찾지 못했습니다/.test(e.message)), null);

  // 12. 도우미 PenGPT 대신 묻기: 도우미가 꺼져 있으면 아무것도 하지 않는다
  check('relay idle when helper offline', (await relayHelperAiJob()) === undefined && $('helperAiMsg').hidden, null);

  // 13. 나이스 승인요청·결재선·비상연락처 (가짜 eXBuilder 화면)
  const fakeDataSet = (columns, rows) => ({
    getColumnNames: () => columns, getRowCount: () => rows.length,
    getValue: (row, column) => rows[row][column], setValue: (row, column, value) => { rows[row][column] = value; },
  });
  const fakeControl = (type, id, extra = {}) => ({ type, id, getChildren: () => extra.children || [], ...extra });
  const fakeApp = (id, controls) => ({
    app: { id }, lookup: (cid) => controls.find((c) => c.id === cid) || null,
    getContainer: () => fakeControl('container', 'root', { children: controls }),
  });
  const runningApps = [];
  window.cpr = { core: { Platform: { INSTANCE: { getAllRunningAppInstances: () => runningApps.slice() } } } };
  check('neis page functions self-contained', [neisPageSubmit, neisPageWatch].every((fn) => !/\bsettings\b|\$\(|chrome\./.test(fn.toString())), null);
  check('submit without open form', /열린 신청 창이 없습니다/.test(neisPageSubmit(NEIS_FORMS, 'trip').problem), null);

  let submitted = 0;
  const tripRows = [{ emgCnctTelno: '010-1111-2222' }];
  const travellerRows = [{ emgCnctTelno: '' }];
  const tripForm = fakeApp(NEIS_FORMS.trip.form, [
    fakeControl('combobox', 'cmbBsrpScCd', { getItems: () => [{ label: '선택', value: '' }, { label: '국내출장(관내)', value: '10' }] }),
    fakeControl('grid', 'grdMain', { dataSet: fakeDataSet(['emgCnctTelno'], tripRows) }),
    fakeControl('grid', 'grdTgpr', { dataSet: fakeDataSet(['invlFlnm', 'emgCnctTelno'], travellerRows) }),
    fakeControl('button', 'btnAply', { value: '승인요청', click: () => { submitted += 1; } }),
  ]);
  runningApps.push(fakeApp('app/com/main/Index', []), tripForm);
  const phoneRun = await neisPageRun({ kind: 'trip', phone: '', steps: [] });
  check('empty traveller phone filled from NEIS number', phoneRun.ok && travellerRows[0].emgCnctTelno === '010-1111-2222' && phoneRun.results.some((r) => r.ok && /비상연락처/.test(r.name)), phoneRun);
  tripRows[0].emgCnctTelno = ''; travellerRows[0].emgCnctTelno = '';
  await neisPageRun({ kind: 'trip', phone: '010-3333-4444', steps: [] });
  check('no NEIS number -> settings phone', tripRows[0].emgCnctTelno === '010-3333-4444' && travellerRows[0].emgCnctTelno === '010-3333-4444', [tripRows, travellerRows]);

  const started = neisPageSubmit(NEIS_FORMS, 'leave');
  await new Promise((r) => setTimeout(r, 20));
  check('submit finds the open trip form', started.ok && started.formId === NEIS_FORMS.trip.form && submitted === 1, started);
  check('watch: nothing new yet', neisPageWatch(started.formId, '출장결재').state === 'waiting', null);
  const confirmApp = fakeApp('popup/dup', [fakeControl('output', 'o1', { value: '같은 기간에 신청한 출장이 있습니다.' }), fakeControl('button', 'b1', { value: '취소' }), fakeControl('button', 'b2', { value: '계속진행' })]);
  runningApps.push(confirmApp);
  const dupStep = neisPageWatch(started.formId, '출장결재');
  check('watch: duplicate check popup', dupStep.state === 'popup' && dupStep.texts[0].includes('같은 기간') && dupStep.buttons.includes('계속진행'), dupStep);
  runningApps.splice(runningApps.indexOf(confirmApp), 1);
  let pickedLine = '';
  const lineCombo = fakeControl('combobox', 'cmbAtrzLine', { value: '', getItems: () => [{ label: '선택', value: '' }, { label: '기본 결재선', value: 'A' }, { label: '출장 결재', value: 'B' }], selectItemByValue: (v) => { pickedLine = v; } });
  runningApps.push(fakeApp('popup/atrz', [lineCombo, fakeControl('button', 'btnSubmit', { value: '상신' })]));
  check('watch: line picked by name', neisPageWatch(started.formId, '출장결재').state === 'ready' && pickedLine === 'B', pickedLine);
  const noLine = neisPageWatch(started.formId, '없는 결재선');
  check('watch: line missing -> list names', noLine.state === 'submit' && noLine.lineNames.join('/') === '기본 결재선/출장 결재', noLine);
  runningApps.length = 0;
  check('watch: form closed', neisPageWatch(started.formId, '출장결재').state === 'closed', null);
  delete window.cpr;

  $('neisLineName').value = ' 출장 결재 '; $('neisPhone').value = '010-0000-0000';
  readSettingsForm();
  check('neis settings read', settings.neis.lineName === '출장 결재' && settings.neis.phone === '010-0000-0000', settings.neis);
  check('open-only button replaced', !document.getElementById('openNeisBtn') && $('neisSubmitBtn').textContent === '승인요청', null);

  // 14. 도우미 부탁으로 K-에듀파인 나의 결재선·과제카드 읽기 (가짜 Nexacro)
  const nexaDataset = (columns, rows) => ({
    getColCount: () => columns.length, getColID: (i) => columns[i], getRowCount: () => rows.length,
    getColumn: (row, column) => rows[row][column],
  });
  const collection = (items) => Object.assign(items.slice(), {});
  const lineDs = nexaDataset(['streReportCoursNm', 'streReportCoursId'], [{ streReportCoursNm: '기본 결재선' }, { streReportCoursNm: ' 출장 결재 ' }]);
  const cardDs = nexaDataset(['tkcrdNm'], [{ tkcrdNm: '[단위과제] 정보보안' }, { tkcrdNm: '[단위과제] 정보보안' }]);
  const docListDs = nexaDataset(['docSj', 'tkcrdNm'], [{ docSj: '남의 문서', tkcrdNm: '남의 카드' }]);
  const innerForm = { all: collection([cardDs, docListDs]) };
  window.nexacro = {
    getApplication: () => ({
      mainframe: { frames: collection([{ form: { all: collection([{ form: innerForm }]) } }]) },
      gdsLine: lineDs,
    }),
  };
  const nexaLists = readEdufineListsInPage();
  check('edufine lists from nexacro datasets', nexaLists.lines.join('/') === '기본 결재선/출장 결재' && nexaLists.cards.join('/') === '[단위과제] 정보보안', nexaLists);
  delete window.nexacro;
  check('edufine lists null outside nexacro', readEdufineListsInPage() === null, null);
  check('helper job kinds', Object.keys(HELPER_JOBS).join() === 'pengpt,edufine_lists' && !/\$\(|chrome\./.test(readEdufineListsInPage.toString()), null);

  // 15. 기타
  check('ollama empty url guarded', (() => { try { ollamaBaseUrl(); return false; } catch (e) { return /Ollama 주소/.test(e.message); } })(), null);
  check('helper pill shows offline', $('helperStatus').textContent === '도우미 꺼짐', $('helperStatus').textContent);
  check('no script errors', window.__errors.length === 0, window.__errors);
  $('testOut').textContent = out.join('\n') + '\nSUMMARY ' + out.filter((l) => l.startsWith('PASS')).length + '/' + out.length;
})().catch((e) => { $('testOut').textContent = 'CRASH ' + e.message + '\n' + e.stack; });
