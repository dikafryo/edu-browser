"""공문작성 도우미 메인 창 — 설정을 들고, 교육청 업무도우미 연결 통로를 열고, 공문 화면(GongmunPanel)을 담는다."""
from PyQt5.QtWidgets import QWidget, QVBoxLayout

from gongmun.bridge import PenBridge
from gongmun.config import APP_NAME, load_settings, save_settings
from gongmun.panel import GongmunPanel

WINDOW_SIZE = (440, 780)  # 공문 작성 창 옆에 세워 두기 좋은 크기


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.settings = load_settings()
        self.setWindowTitle(APP_NAME)
        self.resize(*WINDOW_SIZE)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.panel = GongmunPanel(self)
        layout.addWidget(self.panel)

        # 교육청 업무도우미(크롬 확장)가 보낸 공문 작성 요청을 받는다
        self.pen_bridge = PenBridge(self)
        self.pen_bridge.request_received.connect(self._on_pen_request)
        if not self.pen_bridge.start():
            self.panel.show_notice(
                "warn",
                "교육청 업무도우미와 연결하지 못했습니다. 공문작성 도우미가 이미 하나 켜져 있는지 확인해 주세요. "
                "(이 창에서 직접 쓰는 것은 그대로 됩니다.)")

    def save_settings(self):
        save_settings(self.settings)

    def _on_pen_request(self, request_text):
        self.panel.receive_request(request_text)
        if self.isMinimized():
            self.showNormal()
        self.raise_()
        self.activateWindow()

    def closeEvent(self, event):
        self.pen_bridge.stop()
        super().closeEvent(event)
