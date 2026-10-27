/* PEN 브라우저 – 백그라운드
   도구 모음의 확장 아이콘을 누르면 오른쪽에 사이드 패널이 열리게 한다.
   폴더의 파일이 새 판으로 바뀌면 1분 안에 스스로 다시 불러온다(update.js). */
importScripts('update.js');

/* ===================== 1. 설정 ===================== */
const UPDATE_ALARM = 'pen-check-update';
const UPDATE_CHECK_MINUTES = 1;

/* ===================== 4. 이벤트 연결 ===================== */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) reloadIfUpdated();
});
