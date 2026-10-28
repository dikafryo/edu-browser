# CLAUDE.md

이 저장소는 **한 쌍으로 같이 개발하는 두 프로그램**이다. 한글(HWP) 도우미인 hwpAI(`C:\developer\hwpAI`)와는 별개다 — 공문작성 기능을 hwpAI 에 넣지 말 것.

| 폴더 | 무엇 | 맡는 일 |
|---|---|---|
| `pen-browser/` | 크롬 확장 (MV3, HTML+JS, 빌드 없음) | **크롬 안의 일**: 업무포털 메뉴로 나이스·K-에듀파인 창 열기, K-에듀파인 결재·공람 점검, 연 공문 분석(Ollama/PenGPT), 나이스 복무·출장 신청 창 채우기, PenGPT 위치 지정, 도우미 대신 PenGPT 에 묻기, 진단 |
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

확장은 `chrome://extensions` → 개발자 모드 → `pen-browser/` 로드. **버전을 올리면 새로고침 없이 반영된다** (`update.js`):
- 압축해제 확장은 페이지 파일을 그때그때 폴더에서 읽는다. 그래서 `sidepanel.html` 이 열릴 때 폴더의 manifest 버전과 실행 중인 버전이 다르면 `chrome.runtime.reload()` 한다 — **옛 판(이 기능이 없는 판)이 실행 중이어도 패널을 한 번 열면 새 판이 된다**(시험 C)
- `background.js` 도 1분마다(alarms) 같은 확인을 한다
- 폴더의 manifest 가 깨져 있으면 다시 불러오다 확장이 꺼질 수 있으니 JSON 을 확인하고 버전을 올릴 것
- 크롬 확장 화면(`chrome://`)과 `chrome-extension://` 페이지는 브라우저 자동화 도구로 열 수 없다. 반영 확인은 아래 `live_reload.py` 로 한다

## 시험

```powershell
cd gongmun-helper; .\venv\Scripts\python -m unittest discover -s tests   # 목록 해석·설정 파일·연결 통로·PenGPT 대신 묻기·결재선/과제카드 가져오기(29개)
python tests\pen-browser\run.py                                         # 확장 패널 기능 63개(headless 크롬, 가짜 chrome API)
python tests\pen-browser\live_reload.py                                 # 확장을 실제로 올려 새 판 반영 확인(2~3분, pip install websocket-client)
```

`live_reload.py` 는 임시 프로필의 headless **엣지**에 확장을 올린다 — 크롬 137 이후 정식판은 `--load-extension` 을 무시한다. A 올라옴·패널 / B 폴더 버전이 바뀌면 1분 안에 다시 불러옴 / C 옛 판(태그 `v26.1027.1`)에서 패널을 열면 새 판이 됨.

`tests/pen-browser/run.py` 는 실제 `sidepanel.html` 본문과 스크립트를 `stub_chrome.js` 와 함께 연다. 화면 요소 ID 를 바꾸면 `run_tests.js` 도 고칠 것. headless 크롬은 창 너비가 500px 아래로 안 줄어든다 — 좁은 패널 모양은 360px iframe 에 넣어 확인한다.

## 두 프로그램의 연결 (`gongmun/bridge.py` ↔ `sidepanel.js` 의 `callHelper`)

도우미가 `127.0.0.1:47615` 에서 듣고, 확장이 `fetch` 한다.

- `GET /ping` → `{ok, app, version}`. `POST /gongmun {"request"}` → 도우미 ①칸에 채우고 창을 앞으로. **AI 호출·공문 창 입력은 하지 않는다**(사용자가 확인하고 누른다)
- **도우미의 PenGPT 초안은 거꾸로 흐른다**: PenGPT 는 API 가 없어 도우미가 질문을 `PenBridge` 에 쌓고(`ask_pengpt`), 패널이 2초마다 `POST /ai/next` 로 가져가 `callPenGpt` 로 묻고 `POST /ai/result {id, answer|error}` 로 돌려준다. 패널이 8초 넘게 안 가져가면 '패널이 열려 있지 않음'으로 바로 알린다. 질문(공문 내용)을 담으므로 두 주소 모두 Origin 필수. 작업에는 `kind` 가 붙는다(`pengpt` / `edufine_lists`, 패널은 `HELPER_JOBS` 로 나눈다)
- **나의 결재선·과제카드 가져오기** (`gongmun/edufine_lists.py`): 도우미 ②의 [가져오기] → ① 패널이 열려 있으면 `edufine_lists` 작업으로 PEN 브라우저가 K-에듀파인 탭(없으면 업무포털로 엶)에서 **개인설정 > 나의결재선관리**(일반 웹 화면 `retrieveMyReportCours.do`, 목록 `select#IDC_LIST_SANCLINE`)와 **과제관리 > 나의과제**(Nexacro 화면 `AAAREGSMYMN001M01` 의 `dsList.tkcrdNm`)를 열어 이름만 읽는다(`inbox.js` 의 `readEdufineLists`) → ② 못 얻은 목록만 열린 공문 작성 창에서 읽는다(`read_appr_lines`: `streReportCours` 콤보, `read_task_cards`: 과제카드 선택 창의 `dsAList` 를 읽고 [닫기]). 가져온 이름으로 목록 설정을 바꾸되 '결재할 사람'·'관련 낱말' 메모는 이름이 같으면 남긴다. 2026. 10. 28. 실제 화면에서 결재선 3개·과제카드 21개 확인
- **K-에듀파인 화면 열기**: 전체 메뉴 자료 `app.gdsMenu`(menuId·menuNm·progrmCoursAdres)에서 메뉴 이름으로 번호를 찾아 `app.gv_leftFrame.form.gfnOpenMenu(menuId)` — 왼쪽 메뉴를 누를 때와 같은 함수다(`openEdufineMenuInPage`). Nexacro 자료 위치는 설정 > **K-에듀파인 화면 구조 점검**(자료 이름·열 이름, 메뉴 자료는 행까지)으로 찾는다. 결과 글상자를 UI Automation 으로 읽으면 약 1만 자에서 잘린다
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

실제 업무 시스템이다. **신청·승인요청·상신·저장 버튼은 시험 중에도 누르지 않는다.** (제품 기능으로는 사용자가 패널의 [승인요청]을 눌렀을 때만 나이스 승인요청을 대신 누른다. [상신]은 어떤 경우에도 누르지 않는다.) 채운 신청 창은 `btnCancel`(닫기)로 닫는다.

**업무포털** `pen.eduptl.kr` — 위 메뉴의 `나이스`·`K-에듀파인` 이 새 탭으로 SSO 연결된다. 나이스·K-에듀파인 주소를 직접 열면 로그인이 안 되므로 확장은 업무포털 탭에서 그 메뉴 링크(글자가 꼭 맞는 `<a>`)를 눌러 연다(`openFromPortal`). 확장이 대신 누른 클릭은 팝업 차단에 걸릴 수 있어, 5초 안에 창이 안 뜨면 링크의 http 주소를 새 탭으로 연다. **업무포털 주소를 새 탭에서 직접 열면 로그인 화면(`bpm_lgn_lg00_001.do?noEpSession`)으로 간다**(로그인된 탭은 그대로)

**4세대 나이스** `pen.neis.go.kr/jsp/main.jsp` — eXBuilder6(`cpr`, `cl-control`). HTML 입력칸에 id 가 없으므로 DOM 이 아니라 eXBuilder API 로 다룬다(`neis.js` 의 `neisPageRun`, `world: 'MAIN'` 으로 주입).
- 화면 = 앱 인스턴스: `cpr.core.Platform.INSTANCE.getAllRunningAppInstances()` → `app.app.id`, 컨트롤은 `app.lookup('id')`
- 근무상황: 목록 `edu/ga/srv/mym/mm/srv_mymmm00_m00`(버튼 `btnAply`) → 신청 창 `..._p00`. 칸: `cmbWorkSittnLclfCd`(대분류) → `cmbWorkSittnSclfCd`(소분류) → `cmbWorkSittnDtlCd`(상세), `cmbAvRsnCd`(연가사유), `dtiWorkYmdFrom/To`, `cmbBgngH/M`, `cmbEndH/M`, `ipbWorkSittnRsnCn`(사유), `ipbDestiNm`(목적지), `btnAprvDmnd`(승인요청), `btnCancel`
- 출장: 목록 `edu/ga/srv/mym/mm/srv_mymmm03_m00` → 신청 창 `..._p00`. 칸: `cmbBsrpScCd`(출장종류), 기간은 표 안 편집칸 `dti1`/`dti2`·`cmb10`/`cmb2`(시작 시·분)/`cmb3`/`cmb4`(종료), `ipbDobtNm`(출장지), `ipbBsrpCn`(목적), `ipbMvmnMteCn`(이동사항), `cbxOfflVhcUtilzYn`(공용차량), `cbxTvctPyrfYn`(여비 없음), `btnAply`(승인요청). 출장자 표 시간은 기간과 자동으로 맞춰진다(`sameBsrpPriodYn=Y`)
- **비상연락처**: 기간 표(`grdMain`)와 출장자 표(`grdTgpr`)의 데이터셋에 `emgCnctTelno` 가 따로 있다. 나이스가 처음 채운 번호가 패널로 채우는 동안 한쪽에서 비면 승인요청 때 전화번호 필수 안내로 막힌다 → 채우기 전 번호를 기억했다가 빈 칸에 다시 넣고, 나이스에도 없을 때만 패널 설정의 번호를 쓴다
- **승인요청 흐름** (`neisPageSubmit` → `neisPageWatch`): 누르기 전 떠 있는 앱 인스턴스마다 `penSeenBeforeSubmit` 표시를 남기고, 그 뒤 새로 뜬 앱만 읽는다. 결재선명과 글자가 같은 콤보 항목(또는 표의 행)이 있으면 고르고 멈춘다. `상신` 버튼이 있는데 못 찾으면 결재선 목록을 알려 준다. 그 밖의 새 창(중복 확인 등)은 글자·버튼을 패널에 보여 주고 사용자가 고르기를 기다린다(창이 사라지고 3초간 조용하면 취소로 본다). 결재선은 복무 종류(`NEIS_LINE_KINDS`: 연가·조퇴·외출·출장·종일출장·연수)마다 설정에서 고르고 `neisLineKind` 가 신청 내용으로 종류를 정한다(지각→조퇴, 병가·공가·특별휴가→연가, 하루를 넘기거나 7시간 이상 출장→종일출장, 출장(연수)·연수 대분류→연수). 결재선 이름 목록은 설정의 [나이스에서 결재선 가져오기](상신함 > 개인결재선 등록 화면을 열어 표에서 결재선명 열을 고름, `neisPageReadLines`)나 상신 화면에서 읽어 더한다(`learnLineNames`). 2026. 10. 28. 실제로 2개 읽음 — 이름 열을 못 고르면 오류 안내에 표 구조(열 이름)가 함께 나온다. 예전 판의 단일 `lineName` 은 모든 종류로 옮긴다(`neisDefaults`). 중복 확인·상신 화면의 앱 id 는 아직 직접 확인하지 못해 글자로 찾는다 — 어긋나면 상신 화면을 띄운 채 설정 > **NEIS 화면 구조 점검**(eXBuilder 칸·버튼·콤보 선택지·표 열 이름만 적음)으로 구조를 받아 고칠 것
- **콤보는 `selectItemByValue`** 로 골라야 화면의 연결 동작(소분류 갱신·신청시간 계산)이 돈다. `.value =` 는 이벤트가 없다. 날짜·글자는 `putValue`
- **신청 창이 처음 자료를 다 받기 전에 넣으면 기본값(오늘 09:00)으로 덮어쓴다.** 대분류/출장종류 콤보에 항목이 차고 `grdMain` 에 행이 생긴 뒤 1.2초 더 기다린다. 끝나면 모든 칸을 다시 읽어 되돌려진 칸은 실패로 알린다
- 출장 기간을 데이터셋(`dataSet.setValue`)에 바로 쓰면 날짜는 바뀌어도 신청시간이 다시 계산되지 않는다 → 편집칸 컨트롤로 넣는다
- 어떤 근무상황을 고르면 안내창(`app/cmn/alert`, 버튼 `btnConfirm`)이 뜬다(예: 반일연가 4시간 차감). 글자를 모아 패널에 보여 주고 닫는다
- 대분류→소분류→상세 목록은 `neis.js` 의 `LEAVE_TREE` 에 화면에서 읽은 그대로 둔다. 나이스가 바뀌면 여기를 고칠 것
- 나이스 창: 로그인된 나이스 탭(`cpr` 이 있고 앱 인스턴스가 있음 — `neisPageReady`)이 있으면 쓰고, 없으면 업무포털 메뉴로 연 뒤 최대 40초 기다린다(`getNeisTab`). 방금 연 창은 왼쪽 메뉴를 늦게 그려 `neisPageRun` 이 메뉴 링크를 10초까지 기다린다
- 패널의 시각은 24시간제 선택칸(시 00~23, 분 5분 단위)이다. `input type=time` 은 한국어 크롬에서 오전/오후로 보여 쓰지 않는다

**K-에듀파인** `klef.pen.go.kr/keris_ui/main.do` — 바깥은 Nexacro, 문서 목록은 그 안 `WebBrowser`(iframe)의 일반 HTML 표 `#tbList`.
- 결재대기 머리글: 상태·문서종류·문서유형·공개여부·문서번호·제목·기안(발송)부서·기안(담당)자·기안일시·수신/발신. 공람대기: 상태·문서종류·문서번호·제목·발송기관·공람지정자·공람지정부서·기안일시·공람도착일시·처리유형. 비어 있으면 `colspan` 칸 하나
- 열어 둔 화면 탭마다 iframe 이 남아 있고 모두 '보이는' 상태로 잡힌다 → 머리글로 결재/공람 표를 고른다(`GONGRAM_HEADS`)
- 맨 위 건수: `TopFrame.form.divTopGrp.form.divNtzn.form.divNtznDtl.form.AAB01~04`(결재(긴급)·공람·문서진행·발송대기)의 `text`(태그 섞임)
- 공문 작성: 문서관리 > 기안 > 공용서식 에서 서식을 누르면 WXSClient 창이 뜬다. **같은 서식의 자동저장본이 있으면 '자동저장문서를 읽어오시겠습니까?' 창이 먼저 뜬다** — 사용자의 자동저장본이 걸린 질문이라 도우미는 답하지 않고 `pending_message()` 로 막는다. 이 창(#32770, Button+Static)과 작성 창(#32770 이지만 `Internet Explorer_Server` 를 품음)은 클래스가 같으니 자식 컨트롤로 구별한다
- 크롬 확장 도구로 결과를 읽을 때 `?` 가 섞인 문자열(주소 등)은 출력이 가려진다 — 시험 스크립트는 개수·머리글만 돌려받는다

## 개인정보

- 공문 초안 AI 는 자체 AI 서버(Ollama) 또는 PenGPT 로만 보낸다(도우미 설정 `ai_provider`). 결재·공람 점검은 Ollama 또는 PenGPT 로만 보낸다(확장). 외부 상용 AI 로 보내지 말 것
- 도우미 설정은 `gongmun-helper/data/settings.json` (gitignore). 확장 설정은 `chrome.storage.local`
- 로그·콘솔에 공문 내용을 남기지 않는다(`bridge._Handler.log_message` 를 비워 둔 이유)

## 관례

- 화면 문구·주석은 한국어. JSON 은 `ensure_ascii=False, indent=2`
- 확장 JS 는 파일마다 `1. 설정 / 2. 데이터 처리 / 3. 화면 그리기 / 4. 이벤트 연결` 구역을 둔다. `inbox.js`·`diagnose.js` 는 `sidepanel.js` 의 전역 함수(`askAi`, `showNotice`, `withBusy`, `callHelper` …)를 함께 쓴다 — `sidepanel.html` 의 `<script>` 순서를 바꾸지 말 것
