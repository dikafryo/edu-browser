/* 교육청 업무도우미 – 새 판 반영
   압축해제로 설치한 확장은 폴더의 파일을 그때그때 읽는다. 폴더의 manifest 버전이 지금 실행 중인 버전과 다르면
   chrome.runtime.reload() 로 새 판을 불러온다. background.js(1분마다)와 sidepanel.html(패널을 열 때)이 함께 쓴다.
   덕분에 옛 판이 실행 중이어도 패널을 한 번 열기만 하면 새 판으로 바뀐다(크롬 확장 화면의 새로고침이 필요 없다). */

async function readFolderVersion() {
  try {
    const response = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const manifest = await response.json();
    return manifest.version || '';
  } catch (error) {
    return '';
  }
}

// 다시 불러오면 true. 폴더의 manifest 를 읽지 못하면(고치는 중 등) 그대로 둔다
async function reloadIfUpdated() {
  const folderVersion = await readFolderVersion();
  if (!folderVersion || folderVersion === chrome.runtime.getManifest().version) return false;
  chrome.runtime.reload();
  return true;
}
