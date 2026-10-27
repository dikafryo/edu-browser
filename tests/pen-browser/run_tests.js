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

  // 9. 기타
  check('ollama empty url guarded', (() => { try { ollamaBaseUrl(); return false; } catch (e) { return /Ollama 주소/.test(e.message); } })(), null);
  check('helper pill shows offline', $('helperStatus').textContent === '도우미 꺼짐', $('helperStatus').textContent);
  check('no script errors', window.__errors.length === 0, window.__errors);
  $('testOut').textContent = out.join('\n') + '\nSUMMARY ' + out.filter((l) => l.startsWith('PASS')).length + '/' + out.length;
})().catch((e) => { $('testOut').textContent = 'CRASH ' + e.message + '\n' + e.stack; });
