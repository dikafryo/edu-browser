"""PEN 브라우저 연결 통로 시험 — 확장이 보낸 요청만 받고, 웹사이트가 보낸 요청은 거절하는지."""
import json
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

from PyQt5.QtCore import QCoreApplication, QTimer

from gongmun import bridge
from gongmun.config import PEN_BROWSER_EXTENSION_IDS

TEST_PORT = 47699  # 실제 도우미(47615)가 켜져 있어도 겹치지 않게
EXTENSION_ORIGIN = f"chrome-extension://{PEN_BROWSER_EXTENSION_IDS[0]}"


def request(path, body=None, origin=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode("utf-8") if body is not None else None)
    req = urllib.request.Request(f"http://127.0.0.1:{TEST_PORT}{path}", data=data, method="POST" if data is not None else "GET")
    if origin:
        req.add_header("Origin", origin)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as error:
        with error:
            return error.code, json.loads(error.read())


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QCoreApplication.instance() or QCoreApplication([])
        cls.patcher = mock.patch.object(bridge, "PEN_BRIDGE_PORT", TEST_PORT)
        cls.patcher.start()
        cls.bridge = bridge.PenBridge()
        cls.received = []
        cls.bridge.request_received.connect(cls.received.append)
        assert cls.bridge.start(), "시험용 포트를 열지 못했습니다"

    @classmethod
    def tearDownClass(cls):
        cls.bridge.stop()
        cls.patcher.stop()

    def run_in_thread(self, fn):
        """요청은 다른 스레드에서 보내고, 시그널은 Qt 이벤트 루프가 메인 스레드로 넘긴다."""
        out = {}

        def work():
            try:
                out["value"] = fn()
            except Exception as error:  # 연결이 끊기는 등 — 시험 실패로 드러나게 값으로 남긴다
                out["value"] = (type(error).__name__, {"ok": False, "error": ""})

        worker = threading.Thread(target=work)
        worker.start()
        poll = QTimer()
        poll.timeout.connect(lambda: None if worker.is_alive() else QTimer.singleShot(200, self.app.quit))
        poll.start(50)
        self.app.exec_()
        poll.stop()
        return out["value"]

    def test_ping(self):
        status, body = self.run_in_thread(lambda: request("/ping"))
        self.assertEqual(status, 200)
        self.assertEqual(body["app"], "공문작성 도우미")

    def test_extension_request_reaches_main_thread(self):
        self.received.clear()
        status, body = self.run_in_thread(lambda: request("/gongmun", {"request": "연수 안내"}, EXTENSION_ORIGIN))
        self.assertEqual((status, body["ok"]), (200, True))
        self.assertEqual(self.received, ["연수 안내"])

    def test_rejects_websites_and_missing_origin(self):
        for origin in ("https://evil.example", None):
            status, body = self.run_in_thread(lambda: request("/gongmun", {"request": "x"}, origin))
            self.assertEqual(status, 403)
        status, _ = self.run_in_thread(lambda: request("/ping", origin="https://evil.example"))
        self.assertEqual(status, 403)

    def test_rejects_bad_input(self):
        cases = [({"request": "  "}, None, 400), (None, b"{not json", 400), ({"request": "가" * 40000}, None, 413)]
        for body, raw, expected in cases:
            status, reply = self.run_in_thread(lambda: request("/gongmun", body, EXTENSION_ORIGIN, raw))
            self.assertEqual(status, expected)
            self.assertFalse(reply["ok"])
            self.assertTrue(reply["error"])  # 사용자에게 보여 줄 한국어 메시지

    def test_second_instance_cannot_take_the_port(self):
        self.assertFalse(bridge.PenBridge().start())


if __name__ == "__main__":
    unittest.main()
