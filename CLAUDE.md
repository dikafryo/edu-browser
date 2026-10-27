# CLAUDE.md

이 저장소는 **한 쌍으로 같이 개발하는 두 프로그램**이다. 한글(HWP) 도우미인 hwpAI(`C:\developer\hwpAI`)와는 별개다 — 공문작성 기능을 hwpAI 에 넣지 말 것.

| 폴더 | 무엇 | 맡는 일 |
|---|---|---|
| `pen-browser/` | 크롬 확장 (MV3, HTML+JS, 빌드 없음) | **크롬 안의 일**: 업무 사이트 탭 전환, 결재·공람 점검, 연 공문 분석(Ollama/PenGPT), PenGPT 위치 지정, 진단 |
| `gongmun-helper/` | 공문작성 도우미 (Python + PyQt5 + pywin32) | **크롬 밖의 일**: K-에듀파인 공문 작성 창(WXSClient.exe)에 AI 초안·제목·본문·결재선·과제카드·수신처 넣기 |

나누는 기준: 크롬 확장은 크롬 밖 프로그램(WXSClient)에 손댈 수 없다. 그래서 공문 작성 창을 다루는 기능은 전부 `gongmun-helper` 에 둔다. **pen-browser 에 공문 작성·결재선·과제카드 기능을 다시 넣지 말 것.** 예전 `pen-helper`(PowerShell 네이티브 메시징 호스트)는 `gongmun-helper` 로 대체되어 없어졌고, 확장의 `nativeMessaging` 권한도 뺐다.

## 실행

```powershell
cd gongmun-helper
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python -m gongmun
```

사용자는 `gongmun-helper\실행.bat` 을 더블클릭한다(처음이면 venv 를 만들고 설치까지 한다). 가상환경 폴더 이름은 `venv` 로 통일한다.

확장은 `chrome://extensions` → 개발자 모드 → `pen-browser/` 로드. 코드를 고친 뒤 확장 카드의 새로고침을 눌러야 반영된다.

## 두 프로그램의 연결 (`gongmun/bridge.py` ↔ `sidepanel.js` 의 `callHelper`)

도우미가 `127.0.0.1:47615` 에서 듣고, 확장이 `fetch` 한다.

- `GET /ping` → `{ok, app, version}`. `POST /gongmun {"request"}` → 도우미 ①칸에 채우고 창을 앞으로. **AI 호출·공문 창 입력은 하지 않는다**(사용자가 확인하고 누른다)
- POST 는 `Origin` 이 `PEN_BROWSER_EXTENSION_IDS` 일 때만 받는다. 웹사이트가 보낸 요청은 Origin 이 달라 거절된다
- 확장 ID 는 `manifest.json` 의 `key` 로 고정된다 — key 를 바꾸면 `gongmun/config.py` 의 ID 도 바꿀 것
- 포트는 `gongmun/config.py` 의 `PEN_BRIDGE_PORT` 와 `sidepanel.js` 의 `HELPER_URL` 두 곳에 있다. 같이 바꿀 것
- 윈도우에서 `SO_REUSEADDR` 를 쓰면 도우미 두 개가 같은 포트를 동시에 잡는다 → `SO_EXCLUSIVEADDRUSE`. `HTTPServer.server_bind` 의 `getfqdn()` 은 멈출 수 있어 건너뛴다
- 서버 스레드에서 받은 요청은 Qt 시그널로 메인 스레드에 넘긴다. 서버 스레드에서 위젯을 직접 만지지 말 것

연결 방식을 바꾸면 양쪽을 같이 고친다.

## 버전·릴리스

- 형식 `YY.MMDD.N` (예: 2026-10-27 첫 판 = `26.1027.1`, 같은 날 두 번째 = `26.1027.2`). 태그는 `v` 를 붙인다(`v26.1027.1`)
- 두 곳을 **항상 같은 값으로** 올린다: `pen-browser/manifest.json` 의 `version`, `gongmun-helper/gongmun/config.py` 의 `VERSION`
- 크롬 manifest 버전은 점으로 나눈 정수(각 0~65535)이고 **앞자리 0 을 허용하지 않는다.** 그래서 1~9월은 월 앞의 0 을 뺀다: 1월 5일 = `26.105.1` (`26.0105.1` 은 크롬이 거부). 숫자로 비교해도 날짜 순서가 유지된다(131 < 201 < 930 < 1001)
- 저장소: https://github.com/dikafryo/edu-browser (공개). 개인 IP·주소·이름·명단을 코드나 예시에 넣지 말 것

## 공문 작성 창 조작 (`gongmun/draft_window.py`)

WXSClient 는 32비트 MFC 창 + IE 화면 + 한글 편집기 부품이다. 창 안 IE 문서에 COM 으로 붙어 페이지가 원래 가진 함수(`Doc.setTitle`, `ApprLine_onselchange`, `fncAdd` …)를 부른다. 키보드 흉내는 쓰지 않는다. 비자명한 규칙은 모듈 docstring 에 있다(값은 `data-pen-*` 속성으로 넘김, `alert()` 를 띄울 수 있는 함수는 `setTimeout` 으로 돌림 등). COM 을 쓰는 스레드마다 `pythoncom.CoInitialize()` 가 먼저 필요하다(`panel.EdufineWorker`).

**저장·결재올림(상신)은 절대 누르지 않는다.** 사용자가 눈으로 확인하고 직접 누른다.

## 개인정보

- 공문 초안 AI 는 내 Ollama 로만 보낸다(도우미). 결재·공람 점검은 Ollama 또는 PenGPT 로만 보낸다(확장). 외부 상용 AI 로 보내지 말 것
- 도우미 설정은 `gongmun-helper/data/settings.json` (gitignore). 확장 설정은 `chrome.storage.local`
- 로그·콘솔에 공문 내용을 남기지 않는다(`bridge._Handler.log_message` 를 비워 둔 이유)

## 관례

- 화면 문구·주석은 한국어. JSON 은 `ensure_ascii=False, indent=2`
- 확장 JS 는 파일마다 `1. 설정 / 2. 데이터 처리 / 3. 화면 그리기 / 4. 이벤트 연결` 구역을 둔다. `inbox.js`·`diagnose.js` 는 `sidepanel.js` 의 전역 함수(`askAi`, `showNotice`, `withBusy`, `callHelper` …)를 함께 쓴다 — `sidepanel.html` 의 `<script>` 순서를 바꾸지 말 것
