"""PEN 브라우저 연결 통로 시험 — 확장이 보낸 요청만 받고, 웹사이트가 보낸 요청은 거절하는지."""
import json
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

from PyQt5.QtCore import QCoreApplication

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
        # 이벤트 루프를 직접 돌린다. app.exec_() + 예약 종료는 남은 종료 예약이 다음 시험의 루프를 일찍 끝냈다
        while worker.is_alive():
            self.app.processEvents()
            worker.join(0.01)
        for _ in range(20):  # 서버 스레드가 보낸 시그널이 메인 스레드에 닿을 시간
            self.app.processEvents()
            threading.Event().wait(0.01)
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

    def ask_with_fake_panel(self, panel_reply):
        """도우미가 PenGPT 에 물으면, 가짜 패널이 /ai/next 로 가져가 /ai/result 로 답한다."""
        request("/ai/next", {}, EXTENSION_ORIGIN)  # 패널이 열려 있다는 신호
        seen = {}

        def panel():
            for _ in range(50):
                _, body = request("/ai/next", {}, EXTENSION_ORIGIN)
                if body["job"]:
                    seen["job"] = body["job"]
                    request("/ai/result", {"id": body["job"]["id"], **panel_reply}, EXTENSION_ORIGIN)
                    return
                threading.Event().wait(0.1)

        worker = threading.Thread(target=panel)
        worker.start()
        try:
            return self.bridge.ask_pengpt("시스템", "질문", timeout=10), seen
        except RuntimeError as error:
            return error, seen
        finally:
            worker.join()

    def test_pengpt_relay_answer(self):
        answer, seen = self.ask_with_fake_panel({"answer": '{"title":"제목"}'})
        self.assertEqual(answer, '{"title":"제목"}')
        self.assertEqual((seen["job"]["system"], seen["job"]["user"]), ("시스템", "질문"))
        _, body = request("/ai/next", {}, EXTENSION_ORIGIN)
        self.assertIsNone(body["job"])  # 한 번 가져간 질문은 다시 내주지 않는다

    def test_pengpt_relay_error(self):
        error, _ = self.ask_with_fake_panel({"error": "PenGPT 탭을 찾지 못했습니다."})
        self.assertIsInstance(error, RuntimeError)
        self.assertIn("PenGPT 탭을 찾지 못했습니다", str(error))

    def test_pengpt_needs_open_panel_and_extension_origin(self):
        status, _ = request("/ai/next", {}, "https://evil.example")
        self.assertEqual(status, 403)  # 웹사이트는 쌓인 질문(공문 내용)을 가져갈 수 없다
        with mock.patch.object(bridge.time, "monotonic", return_value=10 ** 9):
            with self.assertRaises(RuntimeError) as caught:
                self.bridge.ask_pengpt("시스템", "질문", timeout=1)
        self.assertIn("패널이 열려 있지 않습니다", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
