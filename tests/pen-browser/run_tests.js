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
  check('no NEIS number -> settings phone (digits)', tripRows[0].emgCnctTelno === '01033334444' && travellerRows[0].emgCnctTelno === '01033334444', [tripRows, travellerRows]);
  tripRows[0].emgCnctTelno = ''; travellerRows[0].emgCnctTelno = '';
  const tripNoPhone = await neisPageRun({ kind: 'trip', phone: '', steps: [] });
  check('trip without any phone -> problem', tripNoPhone.results.some((r) => !r.ok && /비상연락처/.test(r.name)), tripNoPhone);
  runningApps.splice(runningApps.indexOf(tripForm), 1);

  // 근무상황 신청 창: 교원이면 나이스가 연락처를 비워 둔다. 설정 번호가 있으면 넣고, 없으면 조용히 넘어간다
  const leaveRows = [{ emgCnctTelno: null }];
  const leaveForm = fakeApp(NEIS_FORMS.leave.form, [
    fakeControl('combobox', 'cmbWorkSittnLclfCd', { getItems: () => [{ label: '선택', value: '' }, { label: '연가', value: '1' }] }),
    fakeControl('grid', 'grdMain', { dataSet: fakeDataSet(['workSittnSn', 'emgCnctTelno'], leaveRows) }),
  ]);
  runningApps.push(leaveForm);
  const leaveRun = await neisPageRun({ kind: 'leave', phone: '010-5555-6666', steps: [] });
  check('leave phone filled from settings', leaveRun.ok && leaveRows[0].emgCnctTelno === '01055556666' && leaveRun.results.every((r) => r.ok), leaveRun);
  leaveRows[0].emgCnctTelno = null;
  const leaveQuiet = await neisPageRun({ kind: 'leave', phone: '', steps: [] });
  check('leave without phone -> no problem', leaveQuiet.ok && leaveQuiet.results.length === 0, leaveQuiet);
  check('leave job carries phone', buildLeaveJob({ ...readNeisInput(), phone: '010-1' }).phone === '010-1', null);
  runningApps.splice(runningApps.indexOf(leaveForm), 1);
  runningApps.push(tripForm);

  const started = neisPageSubmit(NEIS_FORMS, 'leave');
  await new Promise((r) => setTimeout(r, 20));
  check('submit finds the open trip form', started.ok && started.kind === 'trip' && started.formId === NEIS_FORMS.trip.form && submitted === 1, started);
  const watch = (lineName) => neisPageWatch(started.formId, lineName, NEIS_DRAFT);
  check('watch: nothing new yet', watch('관').state === 'waiting', null);
  const confirmApp = fakeApp('popup/dup', [fakeControl('output', 'o1', { value: '같은 기간에 신청한 출장이 있습니다.' }), fakeControl('button', 'b1', { value: '취소' }), fakeControl('button', 'b2', { value: '계속진행' })]);
  runningApps.push(confirmApp);
  const dupStep = watch('관');
  check('watch: duplicate check popup', dupStep.state === 'popup' && dupStep.texts[0].includes('같은 기간') && dupStep.buttons.includes('계속진행'), dupStep);
  runningApps.splice(runningApps.indexOf(confirmApp), 1);

  // 기안 창 → [개인결재선] → 고르기 창(grd3 → 조회 → grd2) → [지정] → 기안 창 결재자 목록
  const sancrRows = [];
  const lineRows = [{ snclnNm: '관' }, { snclnNm: '관장' }];
  const memberRows = [];
  const clicks = [];
  let selectedLine = -1;
  const pickerApp = fakeApp(NEIS_DRAFT.picker, [
    fakeControl('grid', 'grd3', { dataSet: fakeDataSet(['snclnNo', 'snclnNm'], lineRows), selectRows: (row) => { selectedLine = row; } }),
    fakeControl('button', 'btnSearch', { value: '조회', click: () => { clicks.push('조회'); } }),
    fakeControl('grid', 'grd2', { dataSet: fakeDataSet(['sancrUserNm'], memberRows) }),
    fakeControl('button', 'btn4', { value: '지정', click: () => { clicks.push('지정'); } }),
  ]);
  const draftApp = fakeApp(NEIS_DRAFT.app, [
    fakeControl('button', 'btnSelectMySancr', { value: '개인결재선', click: () => { clicks.push('개인결재선'); } }),
    fakeControl('button', 'btnDrft', { value: '상신', click: () => { clicks.push('상신'); } }),
    fakeControl('dataset', 'dsSancr', { getRowCount: () => sancrRows.length }),
  ]);
  runningApps.push(draftApp);
  check('draft: first look waits for data', watch('관장').state === 'choosing' && clicks.length === 0, clicks);
  check('draft: opens personal lines', watch('관장').state === 'choosing' && clicks.join() === '개인결재선', clicks);
  check('draft: waits for picker', watch('관장').state === 'choosing', null);
  runningApps.push(pickerApp);
  const picking = watch('관장');
  check('picker: selects line by name and searches', picking.state === 'choosing' && selectedLine === 1 && clicks.join() === '개인결재선,조회' && picking.lineNames.join('/') === '관/관장', [picking, selectedLine, clicks]);
  check('picker: waits for members', watch('관장').state === 'choosing' && clicks.length === 2, clicks);
  memberRows.push({ sancrUserNm: '결재자' });
  check('picker: presses 지정', watch('관장').state === 'choosing' && clicks.join() === '개인결재선,조회,지정', clicks);
  runningApps.splice(runningApps.indexOf(pickerApp), 1);
  sancrRows.push({}, {});
  const readyStep = watch('관장');
  check('draft: ready after picker closes', readyStep.state === 'ready' && readyStep.lineNames.join('/') === '관/관장' && !clicks.includes('상신'), [readyStep, clicks]);

  // 이름이 없는 결재선이면 고르기 창을 열어 둔 채 사용자에게 맡긴다
  runningApps.splice(runningApps.indexOf(draftApp), 1);
  const draftApp2 = fakeApp(NEIS_DRAFT.app, draftApp.getContainer().getChildren());
  const pickerApp2 = fakeApp(NEIS_DRAFT.picker, pickerApp.getContainer().getChildren());
  clicks.length = 0;
  runningApps.push(draftApp2);
  watch('없는 결재선');
  watch('없는 결재선');
  runningApps.push(pickerApp2);
  const noLine = watch('없는 결재선');
  check('picker: missing line -> submit with names', noLine.state === 'submit' && noLine.lineNames.join('/') === '관/관장' && clicks.join() === '개인결재선', [noLine, clicks]);
  runningApps.splice(runningApps.indexOf(pickerApp2), 1);
  runningApps.splice(runningApps.indexOf(draftApp2), 1);
  const draftApp3 = fakeApp(NEIS_DRAFT.app, draftApp.getContainer().getChildren());
  runningApps.push(draftApp3);
  check('draft: no line set -> submit right away', watch('').state === 'submit', null);
  runningApps.length = 0;
  check('watch: form closed', watch('관').state === 'closed', null);
  delete window.cpr;

  // 복무 종류별 결재선: 보통 조퇴·외출·출장 / 연가·종일출장 두 묶음
  $('neisLineNames').value = ' 짧은 복무 \n하루 복무\n\n짧은 복무';
  $('neisLineNames').dispatchEvent(new Event('input'));
  check('line map has six kinds with names', $('neisLineMap').querySelectorAll('select').length === 6 && $('neisLine-조퇴').options.length === 3, $('neisLineMap').innerHTML.length);
  ['조퇴', '외출', '출장'].forEach((kind) => { $(`neisLine-${kind}`).value = '짧은 복무'; });
  ['연가', '종일출장'].forEach((kind) => { $(`neisLine-${kind}`).value = '하루 복무'; });
  $('neisPhone').value = '010-0000-0000';
  readSettingsForm();
  check('neis settings read', settings.neis.lineNames.join('/') === '짧은 복무/하루 복무' && settings.neis.lines['외출'] === '짧은 복무'
    && settings.neis.lines['종일출장'] === '하루 복무' && settings.neis.lines['연수'] === '' && settings.neis.phone === '010-0000-0000', settings.neis);
  check('old single line setting carries over', neisDefaults({ lineName: '예전 결재선' }).lines['연수'] === '예전 결재선', null);
  const day = { kind: 'leave', fromDate: '2026-12-30', toDate: '2026-12-30', fromTime: '09:00', toTime: '18:00' };
  const kindOf = (extra) => neisLineKind({ ...day, ...extra });
  check('line kind by request', [
    kindOf({ major: '연가', minor: '연가' }) === '연가', kindOf({ major: '연가', minor: '반일연가' }) === '연가',
    kindOf({ major: '연가', minor: '조퇴' }) === '조퇴', kindOf({ major: '병가', minor: '병지각' }) === '조퇴',
    kindOf({ major: '연가', minor: '외출' }) === '외출', kindOf({ major: '병가', minor: '병가' }) === '연가',
    kindOf({ major: '연수', minor: '교육공무원법제41조연수' }) === '연수',
    kindOf({ kind: 'trip', tripKind: '국내출장(관내)', fromTime: '14:00', toTime: '17:00' }) === '출장',
    kindOf({ kind: 'trip', tripKind: '국내출장(관외)' }) === '종일출장',
    kindOf({ kind: 'trip', tripKind: '국내출장(관내)', toDate: '2026-12-31', fromTime: '15:00', toTime: '10:00' }) === '종일출장',
    kindOf({ kind: 'trip', tripKind: '출장(연수)' }) === '연수',
  ].every(Boolean), null);
  check('open-only button replaced', !document.getElementById('openNeisBtn') && $('neisSubmitBtn').textContent === '승인요청', null);

  // 14. 도우미 부탁으로 K-에듀파인 나의 결재선·과제카드 읽기 (가짜 Nexacro)
  const nexaDataset = (columns, rows) => ({
    getColCount: () => columns.length, getColID: (i) => columns[i], getRowCount: () => rows.length,
    getColumn: (row, column) => rows[row][column],
  });
  const collection = (items) => Object.assign(items.slice(), {});
  const named = (name, value) => Object.assign(value, { name });
  const myCards = named('dsList', nexaDataset(['tkcrdNm'], [{ tkcrdNm: '[단위과제] 정보보안' }, { tkcrdNm: ' 부서일반사무 ' }, { tkcrdNm: '[단위과제] 정보보안' }]));
  const deptCards = named('dsList', nexaDataset(['tkcrdNm'], [{ tkcrdNm: '남의 부서 카드' }]));
  const myScreen = named(EDUFINE_CARD_SCREEN.screen, { all: collection([myCards]) });
  const deptScreen = named('AAAREGSDPMN001M01', { all: collection([deptCards]) });
  const menuRows = [
    { menuId: 'A00AAA01', menuNm: '과제관리', progrmCoursAdres: '' },
    { menuId: 'A00AAA0101', menuNm: '나의과제', progrmCoursAdres: 'aaaregsmymn::AAAREGSMYMN001M01.xfdl' },
  ];
  let openedMenu = '';
  window.nexacro = {
    getApplication: () => ({
      mainframe: { frames: collection([{ form: { all: collection([{ form: deptScreen }, { form: myScreen }]) } }]) },
      gdsMenu: nexaDataset(['menuId', 'menuNm', 'progrmCoursAdres'], menuRows),
      gv_leftFrame: { form: { gfnOpenMenu: (id) => { openedMenu = id; } } },
    }),
  };
  check('my task cards only from 나의과제 screen', readMyTaskCardsInPage(EDUFINE_CARD_SCREEN.screen).join('/') === '[단위과제] 정보보안/부서일반사무', readMyTaskCardsInPage(EDUFINE_CARD_SCREEN.screen));
  check('open edufine menu by name', openEdufineMenuInPage('나의과제') === true && openedMenu === 'A00AAA0101' && openEdufineMenuInPage('과제관리') === false, openedMenu);
  delete window.nexacro;
  check('task cards null outside nexacro', readMyTaskCardsInPage(EDUFINE_CARD_SCREEN.screen) === null, null);
  const lineBox = document.createElement('div');
  lineBox.innerHTML = `<select id="${EDUFINE_LINE_SCREEN.select}" size="20"><option> 관 </option><option>관장</option><option>품의</option></select>`;
  document.body.append(lineBox);
  check('my approval lines from 나의결재선관리 list', readMyApprLinesInPage(EDUFINE_LINE_SCREEN.select).join('/') === '관/관장/품의', null);
  lineBox.remove();
  check('approval lines null on other pages', readMyApprLinesInPage(EDUFINE_LINE_SCREEN.select) === null, null);
  check('helper job kinds', Object.keys(HELPER_JOBS).join() === 'pengpt,edufine_lists'
    && [readMyTaskCardsInPage, readMyApprLinesInPage, openEdufineMenuInPage].every((fn) => !/\$\(|chrome\./.test(fn.toString())), null);

  // 15. 기타
  check('ollama empty url guarded', (() => { try { ollamaBaseUrl(); return false; } catch (e) { return /Ollama 주소/.test(e.message); } })(), null);
  check('helper pill shows offline', $('helperStatus').textContent === '공문헬퍼 꺼짐', $('helperStatus').textContent);
  check('no script errors', window.__errors.length === 0, window.__errors);
  $('testOut').textContent = out.join('\n') + '\nSUMMARY ' + out.filter((l) => l.startsWith('PASS')).length + '/' + out.length;
})().catch((e) => { $('testOut').textContent = 'CRASH ' + e.message + '\n' + e.stack; });
