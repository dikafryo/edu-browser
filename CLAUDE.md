# CLAUDE.md

이 저장소는 **한 쌍으로 같이 개발하는 두 프로그램**이다. 한글(HWP) 도우미인 hwpAI(`C:\developer\hwpAI`)와는 별개다 — 공문작성 기능을 hwpAI 에 넣지 말 것.

| 폴더 | 무엇 | 맡는 일 |
|---|---|---|
| `pen-browser/` | 크롬 확장 (MV3, HTML+JS, 빌드 없음) | **크롬 안의 일**: 업무 사이트 탭 전환, K-에듀파인 결재·공람 점검, 연 공문 분석(Ollama/PenGPT), 나이스 복무·출장 신청 창 채우기, PenGPT 위치 지정, 진단 |
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

확장은 `chrome://extensions` → 개발자 모드 → `pen-browser/` 로드. `background.js` 가 1분마다 폴더의 `manifest.json` 버전을 보고 다르면 `chrome.runtime.reload()` 한다 — **버전을 올리면 새로고침 없이 반영된다.** (이 기능이 없는 v26.1027.1 이전 판은 한 번 손으로 새로고침해야 한다.) 폴더의 manifest 가 깨져 있으면 다시 불러오다 확장이 꺼질 수 있으니 JSON 을 확인하고 버전을 올릴 것.

## 시험

```powershell
cd gongmun-helper; .\venv\Scripts\python -m unittest discover -s tests   # 목록 해석·설정 파일·연결 통로(16개)
python tests\pen-browser\run.py                                         # 확장 패널 기능(headless 크롬, 가짜 chrome API)
```

`tests/pen-browser/run.py` 는 실제 `sidepanel.html` 본문과 스크립트를 `stub_chrome.js` 와 함께 연다. 화면 요소 ID 를 바꾸면 `run_tests.js` 도 고칠 것. headless 크롬은 창 너비가 500px 아래로 안 줄어든다 — 좁은 패널 모양은 360px iframe 에 넣어 확인한다.

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

## 업무 사이트 화면 구조 (2026. 10. 부산 기준, 직접 확인)

실제 업무 시스템이다. **신청·승인요청·상신·저장 버튼은 시험 중에도 누르지 않는다.** 채운 신청 창은 `btnCancel`(닫기)로 닫는다.

**업무포털** `pen.eduptl.kr` — 위 메뉴의 `나이스`·`K-에듀파인` 이 새 탭으로 SSO 연결된다.

**4세대 나이스** `pen.neis.go.kr/jsp/main.jsp` — eXBuilder6(`cpr`, `cl-control`). HTML 입력칸에 id 가 없으므로 DOM 이 아니라 eXBuilder API 로 다룬다(`neis.js` 의 `neisPageRun`, `world: 'MAIN'` 으로 주입).
- 화면 = 앱 인스턴스: `cpr.core.Platform.INSTANCE.getAllRunningAppInstances()` → `app.app.id`, 컨트롤은 `app.lookup('id')`
- 근무상황: 목록 `edu/ga/srv/mym/mm/srv_mymmm00_m00`(버튼 `btnAply`) → 신청 창 `..._p00`. 칸: `cmbWorkSittnLclfCd`(대분류) → `cmbWorkSittnSclfCd`(소분류) → `cmbWorkSittnDtlCd`(상세), `cmbAvRsnCd`(연가사유), `dtiWorkYmdFrom/To`, `cmbBgngH/M`, `cmbEndH/M`, `ipbWorkSittnRsnCn`(사유), `ipbDestiNm`(목적지), `btnAprvDmnd`(승인요청 — 누르지 않음), `btnCancel`
- 출장: 목록 `edu/ga/srv/mym/mm/srv_mymmm03_m00` → 신청 창 `..._p00`. 칸: `cmbBsrpScCd`(출장종류), 기간은 표 안 편집칸 `dti1`/`dti2`·`cmb10`/`cmb2`(시작 시·분)/`cmb3`/`cmb4`(종료), `ipbDobtNm`(출장지), `ipbBsrpCn`(목적), `ipbMvmnMteCn`(이동사항), `cbxOfflVhcUtilzYn`(공용차량), `cbxTvctPyrfYn`(여비 없음), `btnAply`(승인요청 — 누르지 않음). 출장자 표 시간은 기간과 자동으로 맞춰진다(`sameBsrpPriodYn=Y`)
- **콤보는 `selectItemByValue`** 로 골라야 화면의 연결 동작(소분류 갱신·신청시간 계산)이 돈다. `.value =` 는 이벤트가 없다. 날짜·글자는 `putValue`
- **신청 창이 처음 자료를 다 받기 전에 넣으면 기본값(오늘 09:00)으로 덮어쓴다.** 대분류/출장종류 콤보에 항목이 차고 `grdMain` 에 행이 생긴 뒤 1.2초 더 기다린다. 끝나면 모든 칸을 다시 읽어 되돌려진 칸은 실패로 알린다
- 출장 기간을 데이터셋(`dataSet.setValue`)에 바로 쓰면 날짜는 바뀌어도 신청시간이 다시 계산되지 않는다 → 편집칸 컨트롤로 넣는다
- 어떤 근무상황을 고르면 안내창(`app/cmn/alert`, 버튼 `btnConfirm`)이 뜬다(예: 반일연가 4시간 차감). 글자를 모아 패널에 보여 주고 닫는다
- 대분류→소분류→상세 목록은 `neis.js` 의 `LEAVE_TREE` 에 화면에서 읽은 그대로 둔다. 나이스가 바뀌면 여기를 고칠 것

**K-에듀파인** `klef.pen.go.kr/keris_ui/main.do` — 바깥은 Nexacro, 문서 목록은 그 안 `WebBrowser`(iframe)의 일반 HTML 표 `#tbList`.
- 결재대기 머리글: 상태·문서종류·문서유형·공개여부·문서번호·제목·기안(발송)부서·기안(담당)자·기안일시·수신/발신. 공람대기: 상태·문서종류·문서번호·제목·발송기관·공람지정자·공람지정부서·기안일시·공람도착일시·처리유형. 비어 있으면 `colspan` 칸 하나
- 열어 둔 화면 탭마다 iframe 이 남아 있고 모두 '보이는' 상태로 잡힌다 → 머리글로 결재/공람 표를 고른다(`GONGRAM_HEADS`)
- 맨 위 건수: `TopFrame.form.divTopGrp.form.divNtzn.form.divNtznDtl.form.AAB01~04`(결재(긴급)·공람·문서진행·발송대기)의 `text`(태그 섞임)
- 공문 작성: 문서관리 > 기안 > 공용서식 에서 서식을 누르면 WXSClient 창이 뜬다. **같은 서식의 자동저장본이 있으면 '자동저장문서를 읽어오시겠습니까?' 창이 먼저 뜬다** — 사용자의 자동저장본이 걸린 질문이라 도우미는 답하지 않고 `pending_message()` 로 막는다. 이 창(#32770, Button+Static)과 작성 창(#32770 이지만 `Internet Explorer_Server` 를 품음)은 클래스가 같으니 자식 컨트롤로 구별한다
- 크롬 확장 도구로 결과를 읽을 때 `?` 가 섞인 문자열(주소 등)은 출력이 가려진다 — 시험 스크립트는 개수·머리글만 돌려받는다

## 개인정보

- 공문 초안 AI 는 내 Ollama 로만 보낸다(도우미). 결재·공람 점검은 Ollama 또는 PenGPT 로만 보낸다(확장). 외부 상용 AI 로 보내지 말 것
- 도우미 설정은 `gongmun-helper/data/settings.json` (gitignore). 확장 설정은 `chrome.storage.local`
- 로그·콘솔에 공문 내용을 남기지 않는다(`bridge._Handler.log_message` 를 비워 둔 이유)

## 관례

- 화면 문구·주석은 한국어. JSON 은 `ensure_ascii=False, indent=2`
- 확장 JS 는 파일마다 `1. 설정 / 2. 데이터 처리 / 3. 화면 그리기 / 4. 이벤트 연결` 구역을 둔다. `inbox.js`·`diagnose.js` 는 `sidepanel.js` 의 전역 함수(`askAi`, `showNotice`, `withBusy`, `callHelper` …)를 함께 쓴다 — `sidepanel.html` 의 `<script>` 순서를 바꾸지 말 것
