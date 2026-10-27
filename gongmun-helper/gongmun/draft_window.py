"""K-에듀파인 공문 작성 창(WXSClient.exe) 조작.

공문 작성 창은 크롬이 아닌 별도 프로그램(32비트 MFC 창 + IE 화면 + 한글 편집기 부품)이다.
창 안의 IE 문서에 COM 으로 붙어서, 그 페이지가 원래 가진 함수
(Doc.setTitle, ApprLine_onselchange, fncAdd ...)를 부른다. 키보드 입력은 흉내 내지 않는다.

- 값은 data-pen-* 속성으로 넘긴다. 따옴표·줄바꿈이 스크립트를 깨뜨리지 않게 하려는 것이다.
- alert() 를 띄울 수 있는 함수는 setTimeout 으로 돌리고 data-pen-done 으로 끝을 확인한다.
  직접 부르면 사용자가 알림창을 닫을 때까지 이쪽 호출이 멈춘다.
- 과제카드·수신자 지정 창은 모달 창이라 여는 것도 setTimeout 으로 한다.
- COM 을 쓰므로 호출하는 스레드에서 pythoncom.CoInitialize() 가 먼저 필요하다.

흐름은 예전 pen-helper(PowerShell)로 실제 화면에서 검증한 것을 그대로 옮겼다.
"""
import ctypes
import os
import time

import pythoncom
import pywintypes
import win32api
import win32con
import win32gui
import win32process
import win32com.client

DRAFT_URL = "retrieveDoccrdWritng"           # 문서관리카드(기안) 작성 화면
TASK_DIALOG_URL = "taskChoiseTaskNexacroRP"  # 과제카드 선택 창 (Nexacro 화면)
RCVER_DIALOG_URL = "retrieveRcverSetup"      # 수신자지정 창
PROCESS_NAME = "wxsclient.exe"

POLL_SEC = 0.3
DIALOG_WAIT_SEC = 15   # 지정 창은 열면서 서버에서 목록을 받아 온다
SEARCH_WAIT_SEC = 8
STEP_PAUSE_SEC = 1.2   # 클릭 뒤 화면이 후속 요청을 마칠 틈

# 도우미가 스스로 닫는 알림은 '조직 검색 결과 없음' 하나뿐이다. 나머지는 사용자가 읽어야 한다.
NO_RESULT_ALERT = "조회된 내용이 없"

ERROR_MESSAGES = {
    "NO_WINDOW": "공문 작성 창을 찾지 못했습니다. K-에듀파인 문서관리 > 기안 > 공용서식에서 서식을 눌러 공문 작성 창을 연 뒤 다시 눌러 주세요.",
    "NO_DIALOG": "지정 창이 열리지 않았습니다. 공문 작성 창이 다 뜬 뒤 다시 눌러 주세요.",
    "LINE_NOT_FOUND": "K-에듀파인 '나의 결재선'에 그 이름이 없습니다. 목록 설정의 결재선 이름을 나의 결재선 이름과 똑같이 적어 주세요.",
    "TASK_NOT_FOUND": "과제카드를 찾지 못했습니다. 열려 있는 과제카드 선택 창에서 직접 골라 [확인]을 눌러 주세요.",
    "PAGE_BLOCKED": "K-에듀파인 창에 안내 문구가 떠서 멈췄습니다. 그 문구를 확인하고 지정 창에서 마저 진행해 주세요.",
    "EMPTY_LIST": "넣을 수신처가 없습니다.",
    "MESSAGE_OPEN": "공문 작성 창에 안내창이 떠 있습니다. 그 안내창에 먼저 답한 뒤 다시 눌러 주세요.",
    "SCRIPT": "공문 작성 창에서 작업하다 문제가 생겼습니다. 창이 다 뜬 뒤 다시 눌러 주세요.",
}


class EdufineError(Exception):
    """사용자에게 그대로 보여 줄 한국어 메시지를 가진 오류."""

    def __init__(self, code, detail=""):
        super().__init__(ERROR_MESSAGES.get(code, ERROR_MESSAGES["SCRIPT"]))
        self.code = code
        self.detail = detail


# ================================================================
# 창 찾기
# ================================================================
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _process_name(pid):
    handle = ctypes.windll.kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        size = ctypes.c_ulong(260)
        buf = ctypes.create_unicode_buffer(size.value)
        if ctypes.windll.kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value).lower()
        return ""
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def _wxs_windows():
    """공문 작성 프로그램의 보이는 최상위 창들. 앞(최근에 쓴) 창부터."""
    names = {}
    windows = []

    def collect(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        pid = win32process.GetWindowThreadProcessId(hwnd)[1]
        if pid not in names:
            names[pid] = _process_name(pid)
        if names[pid] == PROCESS_NAME:
            windows.append(hwnd)
        return True

    win32gui.EnumWindows(collect, None)
    return windows


def _children(hwnd):
    found = []

    def collect(child, _):
        found.append(child)
        return True

    try:
        win32gui.EnumChildWindows(hwnd, collect, None)
    except pywintypes.error:
        pass  # 자식 창이 없으면 오류로 끝나는 경우가 있다
    return found


def _get_document(ie_server):
    msg = win32gui.RegisterWindowMessage("WM_HTML_GETOBJECT")
    _, result = win32gui.SendMessageTimeout(ie_server, msg, 0, 0, win32con.SMTO_ABORTIFHUNG, 3000)
    if not result:
        return None
    obj = pythoncom.ObjectFromLresult(result, pythoncom.IID_IDispatch, 0)
    return win32com.client.Dispatch(obj)


def find_document(url_pattern):
    """주소에 url_pattern 이 들어간 IE 문서. 없으면 None."""
    for top in _wxs_windows():
        servers = [h for h in _children(top) if win32gui.GetClassName(h) == "Internet Explorer_Server"]
        if not servers:
            continue
        try:
            doc = _get_document(servers[0])
            if doc is not None and url_pattern in doc.url:
                return doc
        except pywintypes.com_error:
            continue
    return None


def is_draft_open():
    return find_document(DRAFT_URL) is not None


def pending_message():
    """공문 작성 프로그램이 띄운 안내창(웹 페이지 메시지)의 글자. 없으면 빈 문자열.

    예: 서식을 열 때 '자동저장문서를 읽어오시겠습니까?' — 사용자의 자동저장본이 걸린 질문이라
    도우미가 대신 답하지 않는다. 안내창이 뜬 채로 입력하면 그 뒤 화면이 바뀌어 엉뚱한 곳에 들어갈 수 있다.
    """
    for top in _wxs_windows():
        if win32gui.GetClassName(top) != "#32770":
            continue
        children = _children(top)
        classes = {win32gui.GetClassName(h) for h in children}
        # 공문 작성 창 자체도 #32770 이다. IE 화면이 들어 있으면 안내창이 아니라 작성 창이다
        if "Internet Explorer_Server" in classes or "Button" not in classes:
            continue
        texts = [win32gui.GetWindowText(h) for h in children if win32gui.GetClassName(h) == "Static"]
        message = " ".join(text.strip() for text in texts if text.strip())
        if message:
            return message
    return ""


def draft_status():
    """창 확인 버튼용: {"open": 공문 작성 창이 있는지, "message": 떠 있는 안내창 글자}."""
    return {"open": is_draft_open(), "message": pending_message()}


def dismiss_alert(text):
    """메시지에 text 가 들어간 페이지 알림창의 [확인]을 누른다."""
    for top in _wxs_windows():
        if win32gui.GetClassName(top) != "#32770":
            continue
        children = _children(top)
        if not any(text in win32gui.GetWindowText(h) for h in children):
            continue
        buttons = [h for h in children if win32gui.GetClassName(h) == "Button"]
        if buttons:
            win32api.SendMessage(buttons[0], win32con.BM_CLICK, 0, 0)
            return True
    return False


# ================================================================
# 페이지 스크립트 실행
# ================================================================
# 스크립트 안에서: D('키') 는 넘긴 값, R 은 결과, b 는 document.body, norm() 은 공백 제거
_PAGE_HEAD = (
    "(function () { var b = document.body, R = ''; "
    "function D(k) { return b.getAttribute('data-pen-' + k) || ''; } "
    "function norm(t) { return String(t || '').replace(/\\s+/g, ''); } try {"
)
_PAGE_TAIL = "} catch (e) { R = 'ERR ' + e.message; } b.setAttribute('data-pen-result', String(R)); })();"


def run_script(doc, script, inputs=None):
    inputs = inputs or {}
    for key, value in inputs.items():
        doc.body.setAttribute(f"data-pen-{key}", str(value))
    doc.parentWindow.execScript(_PAGE_HEAD + script + _PAGE_TAIL, "JavaScript")
    # 지정 창이 이미 닫히는 중이면(확인·닫기를 setTimeout 으로 걸어 둔 직후) 읽을 것이 없다
    try:
        result = doc.body.getAttribute("data-pen-result")
        for key in list(inputs) + ["result"]:
            doc.body.removeAttribute(f"data-pen-{key}")
    except pywintypes.com_error:
        return ""
    return str(result or "")


def start_action(doc, call):
    script = (
        "b.removeAttribute('data-pen-done'); setTimeout(function () { try { "
        + call
        + "; b.setAttribute('data-pen-done', 'OK'); } catch (e) { b.setAttribute('data-pen-done', 'ERR ' + e.message); } }, 50); R = 'OK';"
    )
    run_script(doc, script)


def wait_until(probe, timeout_sec):
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        try:
            value = probe()
            if value:
                return value
        except pywintypes.com_error:
            pass  # 화면이 바뀌는 중에는 잠깐 접근이 막힐 수 있다
        time.sleep(POLL_SEC)
    return None


def _action_done(doc):
    return str(doc.body.getAttribute("data-pen-done") or "")


def invoke_action(doc, call):
    """알림창이 떠서 끝나지 않으면 더 진행하지 않고 멈춘다."""
    start_action(doc, call)
    if not wait_until(lambda: _action_done(doc), SEARCH_WAIT_SEC):
        raise EdufineError("PAGE_BLOCKED")
    time.sleep(STEP_PAUSE_SEC)


def _draft_document():
    message = pending_message()
    if message:
        raise EdufineError("MESSAGE_OPEN", message)
    doc = find_document(DRAFT_URL)
    if doc is None:
        raise EdufineError("NO_WINDOW")
    return doc


def _open_dialog(call, dialog_url, ready_script):
    opened = find_document(dialog_url)  # 사용자가 이미 열어 둔 경우
    if opened is not None:
        return opened
    start_action(_draft_document(), call)

    def ready():
        dialog = find_document(dialog_url)
        if dialog is not None and run_script(dialog, ready_script) == "READY":
            return dialog
        return None

    dialog = wait_until(ready, DIALOG_WAIT_SEC)
    if dialog is None:
        raise EdufineError("NO_DIALOG")
    return dialog


# ================================================================
# 제목·본문
# ================================================================
_FILL_SCRIPT = r"""
var title = D('title'), text = D('body');
if (title) {
  Doc.setTitle(title);
  var sj = document.getElementById('Sj');
  if (sj) sj.value = title;
}
if (text) IMPL_PutFieldText('editor1', CELL_CBODY, text.replace(/\r?\n/g, '\r\n'), DATATYPE_TEXT);
R = 'OK';
"""


def fill_draft(title, body):
    result = run_script(_draft_document(), _FILL_SCRIPT, {"title": title, "body": body})
    if result != "OK":
        raise EdufineError("SCRIPT", result)


# ================================================================
# 결재선: 공문 작성 창의 '나의 결재선' 콤보박스
# ================================================================
_APPR_PICK_SCRIPT = r"""
var s = document.getElementById('streReportCours'), names = [], found = -1;
for (var i = 1; i < s.options.length; i++) {
  names.push(s.options[i].text);
  if (norm(s.options[i].text) === norm(D('name'))) found = i;
}
if (found < 0) { R = 'NOT_FOUND ' + names.join(', '); }
else { s.selectedIndex = found; R = 'OK'; }
"""

_APPR_READ_SCRIPT = r"""
var area = document.getElementById('tabarea01'), rows = area ? area.getElementsByTagName('tr') : [], out = [];
for (var i = 0; i < rows.length; i++) {
  var cells = rows[i].getElementsByTagName('td');
  if (cells.length >= 4) out.push(norm(cells[1].innerText) + ' ' + norm(cells[2].innerText) + ' ' + norm(cells[3].innerText));
}
R = out.join('\n');
"""


def set_appr_line(name):
    """나의 결재선을 골라 적용하고, 적용된 결재경로(처리방법 직위 처리자)를 돌려준다."""
    doc = _draft_document()
    before = run_script(doc, _APPR_READ_SCRIPT)
    picked = run_script(doc, _APPR_PICK_SCRIPT, {"name": name})
    if picked.startswith("NOT_FOUND"):
        raise EdufineError("LINE_NOT_FOUND", picked[len("NOT_FOUND "):])
    if picked != "OK":
        raise EdufineError("SCRIPT", picked)
    # 숨은 프레임에서 적용된다. 같은 결재선을 다시 고르면 표가 바뀌지 않으므로 시간이 지나면 그대로 읽는다
    start_action(doc, "ApprLine_onselchange()")

    def changed():
        rows = run_script(doc, _APPR_READ_SCRIPT)
        return rows if rows != before else None

    after = wait_until(changed, SEARCH_WAIT_SEC) or run_script(doc, _APPR_READ_SCRIPT)
    return [row for row in after.split("\n") if row]


# ================================================================
# 과제카드 선택 창 (Nexacro)
# ================================================================
_TASK_FORM = "var f = nexacro.getApplication().mainframe.QuickViewFrame.form;"
_TASK_OPEN_READY = _TASK_FORM + " R = (f && f.Tab00) ? 'READY' : '';"
_TASK_LIST_READY = _TASK_FORM + " R = (f && f.dsAList && f.dsAList.getRowCount() > 0) ? 'READY' : '';"

# 정확히 같은 이름([단위과제] 머리말은 있어도 없어도 됨)을 먼저, 없으면 이름이 들어간 첫 카드
_TASK_PICK_SCRIPT = _TASK_FORM + r"""
var ds = f.dsAList, want = norm(D('name')), exact = -1, part = -1;
for (var i = 0; i < ds.getRowCount(); i++) {
  var full = norm(ds.getColumn(i, 'tkcrdNm')), bare = full.replace(/^\[[^\]]*\]/, '');
  if (full === want || bare === want) { exact = i; break; }
  if (part < 0 && full.indexOf(want) >= 0) part = i;
}
var row = exact >= 0 ? exact : part;
if (row < 0) { R = ''; }
else { f.fnSelectUnitTkcrd(row); R = 'PICKED ' + ds.getColumn(row, 'tkcrdNm'); }
"""

_TASK_SEARCH_SCRIPT = _TASK_FORM + " f.dsSrchParam.setColumn(0, 'tkcrdNm', D('name')); f.fnSearch(); R = 'OK';"


def set_task_card(name, dry_run=False):
    """과제카드를 골라 [확인]까지 누르고, 고른 카드 이름을 돌려준다.

    못 찾으면 선택 창을 열어 둔 채 TASK_NOT_FOUND 를 낸다(사용자가 직접 고르도록).
    dry_run 이면 [확인] 대신 [닫기]를 누른다(시험용).
    """
    dialog = _open_dialog("fncChooseTkcrd()", TASK_DIALOG_URL, _TASK_OPEN_READY)
    inputs = {"name": name}
    # 카드 목록은 화면보다 조금 늦게 온다. 목록이 비어 있으면 아래 검색으로 넘어간다
    wait_until(lambda: run_script(dialog, _TASK_LIST_READY) == "READY", SEARCH_WAIT_SEC)
    picked = run_script(dialog, _TASK_PICK_SCRIPT, inputs)
    if not picked:
        run_script(dialog, _TASK_SEARCH_SCRIPT, inputs)
        picked = wait_until(lambda: run_script(dialog, _TASK_PICK_SCRIPT, inputs), SEARCH_WAIT_SEC)
    if not picked or picked.startswith("ERR"):
        raise EdufineError("TASK_NOT_FOUND", picked or "")
    time.sleep(STEP_PAUSE_SEC)
    finish = "f.btnClose_onclick()" if dry_run else "f.Tab00_Tabpage1_divAuth_btnAuthC01_onclick()"
    start_action(dialog, f"{_TASK_FORM} {finish}")
    return picked[len("PICKED "):]


# ================================================================
# 수신자지정 창
# ================================================================
_RCVER_READY = "R = (document.readyState === 'complete' && typeof fncAdd === 'function') ? 'READY' : '';"

# 찾는 스크립트는 누를 칸만 window.__penBoxes 에 담는다. 누르는 것은 알림창이 뜰 수 있어 page action 으로 한다.
# .checked 대신 click(): 그룹 칸의 onclick 이 구성원을 불러오고, fncAdd 는 구성원 없는 그룹을 거부한다.
_RCVER_TOGGLE_CALL = "for (var i = 0; i < window.__penBoxes.length; i++) window.__penBoxes[i].click()"

# 그룹 칸의 값은 'id| |그룹 이름|...'. 찾은 이름을 한 줄에 하나씩 돌려준다.
_RCVER_GROUP_SCRIPT = r"""
var wanted = D('names').split('\n'), boxes = document.getElementById(D('area')).getElementsByTagName('input'), hit = [];
window.__penBoxes = [];
for (var i = 0; i < boxes.length; i++) {
  if (boxes[i].name !== 'recptnGroup') continue;
  var label = norm(String(boxes[i].value).split('|')[2]), want = '';
  for (var j = 0; j < wanted.length; j++) if (wanted[j] && norm(wanted[j]) === label) want = wanted[j];
  if (Boolean(want) !== boxes[i].checked) window.__penBoxes.push(boxes[i]);
  if (want) hit.push(want);
}
R = hit.join('\n');
"""

_RCVER_SEARCH_SCRIPT = "document.getElementsByName('orgnztNm')[0].value = D('name'); R = 'OK';"

# 검색 결과 칸의 값은 'id|기관 이름|...'. 정확히 같은 이름을 먼저, 없으면 하나뿐인 부분 일치
_RCVER_ORG_PICK_SCRIPT = r"""
var boxes = document.getElementsByName('orgnztChk'), want = norm(D('name')), exact = -1, part = [];
window.__penBoxes = [];
for (var i = 0; i < boxes.length; i++) {
  if (boxes[i].checked) window.__penBoxes.push(boxes[i]);
  var label = norm(String(boxes[i].value).split('|')[1]);
  if (label === want) exact = i;
  else if (label.indexOf(want) >= 0) part.push(i);
}
var pick = exact >= 0 ? exact : (part.length === 1 ? part[0] : -1);
if (pick >= 0) { window.__penBoxes.push(boxes[pick]); R = 'PICKED'; }
else if (boxes.length > 0) { R = 'NONE'; }
"""

_RCVER_COUNT_SCRIPT = "var list = document.getElementById('IDC_HDUAGENT_RECVDEPT'); R = String(list ? list.options.length : 0);"

_RCVER_GROUP_TABS = (
    ("RecpPersnalOrgGroup", "tabarea05"),  # 개인수신그룹
    ("RecpMainOrgGroup", "tabarea01"),     # 공용그룹
)


def _add_groups(dialog, remaining):
    for tab, area in _RCVER_GROUP_TABS:
        if not remaining:
            return
        found = run_script(dialog, _RCVER_GROUP_SCRIPT, {"names": "\n".join(remaining), "area": "frm" + tab})
        hits = [name for name in found.split("\n") if name]
        if not hits:
            continue
        invoke_action(dialog, f"onTabRecpChange('{tab}', '{area}')")
        invoke_action(dialog, _RCVER_TOGGLE_CALL)
        invoke_action(dialog, "fncAdd()")
        for name in hits:
            remaining.remove(name)


def _add_org(dialog, name):
    inputs = {"name": name}
    run_script(dialog, _RCVER_SEARCH_SCRIPT, inputs)
    start_action(dialog, "onTabRecpChange('RecpOrgTree', 'tabarea03'); fncOrgnztSearch2()")

    def search_finished():
        if _action_done(dialog):
            return "DONE"
        if dismiss_alert(NO_RESULT_ALERT):
            return "NO_RESULT"
        return None

    outcome = wait_until(search_finished, SEARCH_WAIT_SEC)
    if outcome is None:
        raise EdufineError("PAGE_BLOCKED")
    if outcome == "NO_RESULT":
        wait_until(lambda: _action_done(dialog), SEARCH_WAIT_SEC)
        return False
    picked = wait_until(lambda: run_script(dialog, _RCVER_ORG_PICK_SCRIPT, inputs), SEARCH_WAIT_SEC)
    if picked != "PICKED":
        return False
    invoke_action(dialog, _RCVER_TOGGLE_CALL)
    invoke_action(dialog, "fncAdd()")
    return True


def set_recipients(names, dry_run=False):
    """그룹 이름은 그룹째로, 나머지는 조직도 검색으로 넣는다.

    모두 넣었을 때만 [확인]을 누른다. 못 찾은 이름이 있으면 창을 열어 두어 사용자가 마저 고르게 한다.
    dry_run 이면 [확인] 대신 [닫기]를 누른다(시험용).
    반환: {"added": 목록 수, "missing": [못 찾은 이름], "confirmed": bool}
    """
    names = [name.strip() for name in names if name.strip()]
    if not names:
        raise EdufineError("EMPTY_LIST")
    dialog = _open_dialog("fncRcverAppn()", RCVER_DIALOG_URL, _RCVER_READY)
    remaining = list(names)
    _add_groups(dialog, remaining)
    missing = [name for name in remaining if not _add_org(dialog, name)]
    added = int(run_script(dialog, _RCVER_COUNT_SCRIPT) or 0)
    confirmed = not missing and added > 0
    if confirmed:
        start_action(dialog, "fncClose()" if dry_run else "fncVerifyChoose()")
    return {"added": added, "missing": missing, "confirmed": confirmed}
