/* PEN 브라우저 – 백그라운드
   도구 모음의 확장 아이콘을 누르면 오른쪽에 사이드 패널이 열리게 한다.
   폴더의 파일이 새 버전으로 바뀌면 스스로 다시 불러온다(크롬 확장 화면에서 새로고침을 누르지 않아도 되게). */

/* ===================== 1. 설정 ===================== */
const UPDATE_ALARM = 'pen-check-update';
const UPDATE_CHECK_MINUTES = 1;

/* ===================== 2. 데이터 처리 ===================== */
// 압축해제로 설치한 확장은 폴더의 파일을 그때그때 읽으므로, 폴더의 manifest 버전과 지금 실행 중인 버전을 비교한다
async function readFolderVersion() {
  try {
    const response = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const manifest = await response.json();
    return manifest.version || '';
  } catch (error) {
    return '';
  }
}

async function reloadIfUpdated() {
  const folderVersion = await readFolderVersion();
  if (folderVersion && folderVersion !== chrome.runtime.getManifest().version) chrome.runtime.reload();
}

/* ===================== 4. 이벤트 연결 ===================== */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) reloadIfUpdated();
});
