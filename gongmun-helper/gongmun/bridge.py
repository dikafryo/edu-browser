"""PEN 브라우저(크롬 확장) ↔ 공문작성 도우미 연결 통로.

K-에듀파인 공문 작성 창은 크롬 밖 프로그램이라 크롬 확장이 손댈 수 없다.
그래서 PEN 브라우저는 공문 작성 요청을 같은 PC 의 공문작성 도우미로 넘기고, 입력은 도우미가 맡는다.
거꾸로 도우미가 PenGPT 로 초안을 만들 때는 PenGPT 에 API 가 없으므로, 질문을 여기에 쌓아 두면
PEN 브라우저 패널이 2초마다 가져가 열어 둔 PenGPT 탭에 대신 묻고 답을 돌려준다.
같은 통로로 'K-에듀파인 탭에서 나의 결재선·과제카드 이름 읽기'도 맡긴다(작업 kind 로 구분).

- 127.0.0.1 에서만 듣는다. 다른 PC 에서는 접속할 수 없다.
- Origin 헤더가 PEN 브라우저 확장인 요청만 받는다. 웹사이트가 몰래 보낸 요청은 Origin 이
  그 사이트 주소라 거절된다. (/ping 은 Origin 이 비어 있어도 답한다 — 버전만 알려 준다)
- 받은 공문 요청은 '어떤 공문인가요?' 칸에 채우기만 한다. AI 호출·공문 창 입력은 사용자가 누른다.

  GET  /ping       → {"ok": true, "app": "공문작성 도우미", "version": "..."}
  POST /gongmun    {"request": "..."} → {"ok": true}
  POST /ai/next    {} → {"ok": true, "job": {"id", "kind", ...} 또는 null}
                   kind "pengpt": {"system", "user"} / kind "edufine_lists": 추가 값 없음
  POST /ai/result  {"id", "answer"} 또는 {"id", "error"} → {"ok": true}
                   edufine_lists 의 answer 는 {"lines": [...], "cards": [...]} JSON 글자
"""
import itertools
import json
import socket
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PyQt5.QtCore import QObject, pyqtSignal

from gongmun.config import VERSION, PEN_BRIDGE_PORT, PEN_BROWSER_EXTENSION_IDS

MAX_BODY_BYTES = 64 * 1024  # 공문 요청 글·AI 답은 이보다 훨씬 짧다
# 너무 긴 요청도 이만큼까지는 읽어 버린 뒤 답한다. 읽지 않고 답하면 연결이 끊겨 확장이 '도우미 꺼짐'으로 잘못 안내한다
DRAIN_LIMIT_BYTES = 1024 * 1024
TOO_LONG = object()
ALLOWED_ORIGINS = {f"chrome-extension://{ext_id}" for ext_id in PEN_BROWSER_EXTENSION_IDS}

# 패널이 2초마다 가져가므로, 이만큼 소식이 없으면 PEN 브라우저 패널이 닫혀 있다고 본다
PANEL_ALIVE_SEC = 8
# 확장의 PenGPT 대기(3분)보다 조금 길게 기다린다
PENGPT_TIMEOUT_SEC = 200
PANEL_CLOSED = ("PEN 브라우저 패널이 열려 있지 않습니다. 크롬에서 PEN 브라우저 아이콘을 눌러 패널을 열어 두고 "
                "(PenGPT 탭도 로그인해 열어 둔 채) 다시 눌러 주세요.")
# 결재선·과제카드 읽기는 K-에듀파인을 열고(최대 40초) 두 화면이 목록을 받을 때까지(각 15초) 기다린다
LISTS_TIMEOUT_SEC = 120


class _Handler(BaseHTTPRequestHandler):
    server_version = "gongmun-helper"

    def log_message(self, *args):
        pass  # 요청 내용(공문 글)이 콘솔·로그에 남지 않게 한다

    def _reply(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _origin_ok(self, required):
        origin = self.headers.get("Origin")
        if origin is None:
            return not required
        return origin in ALLOWED_ORIGINS

    def do_GET(self):
        if self.path != "/ping":
            self._reply(404, {"ok": False, "error": "없는 주소입니다."})
            return
        if not self._origin_ok(required=False):
            self._reply(403, {"ok": False, "error": "PEN 브라우저에서만 쓸 수 있습니다."})
            return
        self._reply(200, {"ok": True, "app": "공문작성 도우미", "version": VERSION})

    def do_POST(self):
        routes = {"/gongmun": self._post_gongmun, "/ai/next": self._post_ai_next, "/ai/result": self._post_ai_result}
        route = routes.get(self.path)
        if route is None:
            self._reply(404, {"ok": False, "error": "없는 주소입니다."})
            return
        if not self._origin_ok(required=True):
            self._reply(403, {"ok": False, "error": "PEN 브라우저에서만 쓸 수 있습니다."})
            return
        payload = self._read_json()
        if payload is TOO_LONG:
            self._reply(413, {"ok": False, "error": "보낸 내용이 너무 깁니다. 핵심만 줄여서 다시 보내 주세요."})
            return
        if payload is None:
            self._reply(400, {"ok": False, "error": "보낸 내용을 읽지 못했습니다. 다시 보내 주세요."})
            return
        route(payload)

    def _post_gongmun(self, payload):
        request_text = str(payload.get("request", "")).strip()
        if not request_text:
            self._reply(400, {"ok": False, "error": "보낼 공문 내용이 비어 있습니다."})
            return
        self.server.bridge.request_received.emit(request_text)
        self._reply(200, {"ok": True})

    def _post_ai_next(self, payload):
        self._reply(200, {"ok": True, "job": self.server.bridge.take_ai_job()})

    def _post_ai_result(self, payload):
        self.server.bridge.finish_ai_job(payload.get("id"), payload.get("answer"), payload.get("error"))
        self._reply(200, {"ok": True})

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length <= 0 or length > DRAIN_LIMIT_BYTES:
            return None
        if length > MAX_BODY_BYTES:
            self.rfile.read(length)
            return TOO_LONG
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    # 윈도우에서 SO_REUSEADDR 를 켜면 도우미를 두 개 켰을 때 같은 포트를 둘 다 차지해
    # 요청이 엉뚱한 쪽으로 간다. 대신 포트를 혼자 쓰도록 잠근다.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        # HTTPServer.server_bind 는 socket.getfqdn() 을 불러 학교망에서 수십 초 멈출 수 있어 건너뛴다
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class _PanelJob:
    def __init__(self, job_id, fields):
        self.id = job_id
        self.fields = fields  # 패널에 넘길 값 (kind 포함)
        self.taken = False
        self.answer = None
        self.error = None
        self.done = threading.Event()


class PenBridge(QObject):
    """요청은 서버 스레드에서 받고, 화면 반영은 시그널로 메인 스레드에 넘긴다."""

    request_received = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._server = None
        self._jobs = {}
        self._job_ids = itertools.count(1)
        self._lock = threading.Lock()
        self._last_panel_poll = 0.0

    def start(self):
        """포트를 이미 쓰고 있으면(도우미를 두 개 켠 경우 등) False 를 돌려준다."""
        try:
            self._server = _Server(("127.0.0.1", PEN_BRIDGE_PORT), _Handler)
        except OSError:
            self._server = None
            return False
        self._server.bridge = self
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return True

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    # ---------- PenGPT 대신 묻기 ----------
    def panel_alive(self):
        return time.monotonic() - self._last_panel_poll < PANEL_ALIVE_SEC

    def take_ai_job(self):
        """패널이 가져갈 질문 하나. 없으면 None. 한 질문은 한 번만 내준다."""
        with self._lock:
            self._last_panel_poll = time.monotonic()
            for job in self._jobs.values():
                if not job.taken:
                    job.taken = True
                    return {"id": job.id, **job.fields}
        return None

    def finish_ai_job(self, job_id, answer, error):
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return  # 이미 시간이 지나 포기한 질문
        job.answer = str(answer or "")
        job.error = str(error) if error else None
        job.done.set()

    def _ask_panel(self, fields, timeout, timeout_message, error_prefix=""):
        """작업 스레드에서 부른다. 패널이 돌려준 답 글자. 실패하면 한국어 메시지의 RuntimeError."""
        if self._server is None:
            raise RuntimeError("PEN 브라우저와 연결 통로가 열려 있지 않습니다. 공문작성 도우미를 하나만 켜 두세요.")
        if not self.panel_alive():
            raise RuntimeError(PANEL_CLOSED)
        with self._lock:
            job = _PanelJob(next(self._job_ids), fields)
            self._jobs[job.id] = job
        deadline = time.monotonic() + timeout
        try:
            while not job.done.wait(1):
                # 가져가기 전에 패널이 닫히면 끝까지 기다리지 않고 바로 알린다
                if not job.taken and not self.panel_alive():
                    raise RuntimeError(PANEL_CLOSED)
                if time.monotonic() > deadline:
                    raise RuntimeError(timeout_message)
        finally:
            with self._lock:
                self._jobs.pop(job.id, None)
        if job.error:
            raise RuntimeError(error_prefix + job.error)
        return job.answer

    def ask_pengpt(self, system, user, timeout=PENGPT_TIMEOUT_SEC):
        return self._ask_panel({"kind": "pengpt", "system": system, "user": user}, timeout,
                               "PenGPT 답이 3분 넘게 오지 않았습니다. PenGPT 탭을 확인한 뒤 다시 눌러 주세요.",
                               "PenGPT 에 묻지 못했습니다: ")

    def ask_edufine_lists(self, timeout=LISTS_TIMEOUT_SEC):
        """크롬 K-에듀파인 탭에서 읽은 {"lines": [결재선 이름], "cards": [과제카드 이름]}."""
        answer = self._ask_panel({"kind": "edufine_lists"}, timeout,
                                 "PEN 브라우저가 K-에듀파인 목록을 읽어 오지 못했습니다. 크롬의 K-에듀파인 탭을 확인해 주세요.")
        try:
            data = json.loads(answer)
        except ValueError:
            raise RuntimeError("PEN 브라우저가 보낸 목록을 읽지 못했습니다. PEN 브라우저를 새 판으로 고친 뒤 다시 눌러 주세요.") from None
        clean = lambda values: [str(v).strip() for v in values or [] if str(v).strip()]
        return {"lines": clean(data.get("lines")), "cards": clean(data.get("cards"))}
