"""PEN 브라우저(크롬 확장) → 공문작성 도우미 연결 통로.

K-에듀파인 공문 작성 창은 크롬 밖 프로그램이라 크롬 확장이 손댈 수 없다.
그래서 PEN 브라우저는 공문 작성 요청을 같은 PC 의 공문작성 도우미로 넘기고, 입력은 도우미가 맡는다.

- 127.0.0.1 에서만 듣는다. 다른 PC 에서는 접속할 수 없다.
- Origin 헤더가 PEN 브라우저 확장인 요청만 받는다. 웹사이트가 몰래 보낸 요청은 Origin 이
  그 사이트 주소라 거절된다. (/ping 은 Origin 이 비어 있어도 답한다 — 버전만 알려 준다)
- 받은 내용은 '어떤 공문인가요?' 칸에 채우기만 한다. AI 호출·공문 창 입력은 사용자가 누른다.

  GET  /ping     → {"ok": true, "app": "공문작성 도우미", "version": "..."}
  POST /gongmun  {"request": "..."} → {"ok": true}
"""
import json
import socket
import socketserver
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PyQt5.QtCore import QObject, pyqtSignal

from gongmun.config import VERSION, PEN_BRIDGE_PORT, PEN_BROWSER_EXTENSION_IDS

MAX_BODY_BYTES = 64 * 1024  # 공문 요청 글은 이보다 훨씬 짧다
ALLOWED_ORIGINS = {f"chrome-extension://{ext_id}" for ext_id in PEN_BROWSER_EXTENSION_IDS}


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
        if self.path != "/gongmun":
            self._reply(404, {"ok": False, "error": "없는 주소입니다."})
            return
        if not self._origin_ok(required=True):
            self._reply(403, {"ok": False, "error": "PEN 브라우저에서만 쓸 수 있습니다."})
            return
        request_text = self._read_request_text()
        if request_text is None:
            self._reply(400, {"ok": False, "error": "보낸 내용을 읽지 못했습니다. 다시 보내 주세요."})
            return
        if not request_text:
            self._reply(400, {"ok": False, "error": "보낼 공문 내용이 비어 있습니다."})
            return
        self.server.bridge.request_received.emit(request_text)
        self._reply(200, {"ok": True})

    def _read_request_text(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY_BYTES:
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None
        if not isinstance(payload, dict):
            return None
        return str(payload.get("request", "")).strip()


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


class PenBridge(QObject):
    """요청은 서버 스레드에서 받고, 화면 반영은 시그널로 메인 스레드에 넘긴다."""

    request_received = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._server = None

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
