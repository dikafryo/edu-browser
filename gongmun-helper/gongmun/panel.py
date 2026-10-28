"""공문작성 도우미 화면 — K-에듀파인 공문 작성 창에 넣을 내용을 만들고 넣는다.

    ① 어떤 공문인지 적고 [AI로 초안 만들기]  (자체 AI 서버 또는 PenGPT 로만 보냄)
    ② 제목·본문 확인, 결재선·과제카드·수신처 고르기 (목록은 K-에듀파인에서 가져올 수 있음)
    ③ 공문 작성 창에 넣기 (제목·본문 / 결재선 / 과제카드 / 수신처)

공문 작성 창 조작은 gongmun.draft_window 가 맡는다. 저장·결재올림(상신)은 누르지 않는다.
"""
import pythoncom
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QPushButton, QLabel,
    QLineEdit, QPlainTextEdit, QComboBox, QScrollArea, QFrame, QDialog,
)
from PyQt5.QtCore import Qt, QThread, pyqtSignal

from gongmun import draft_window
from gongmun.draft_ai import ollama_asker, parse_task_cards, request_draft
from gongmun.edufine_lists import fetch_lists, merge_appr_lines, merge_task_cards, parse_approval_lines
from gongmun.settings_dialog import SettingsDialog

# 엑셀에서 기관명 열을 통째로 붙여 넣을 때 따라오는 제목 줄
HEADER_WORDS = {"기관명", "수신처", "수신기관", "학교명", "기관", "수신자"}

MAIN_BTN_STYLE = """
    QPushButton {
        padding: 8px; font-size: 12px; font-weight: bold;
        background-color: #3498db; color: white;
        border: none; border-radius: 4px;
    }
    QPushButton:hover { background-color: #2e86c1; }
    QPushButton:disabled { background-color: #aed6f1; }
"""
SUB_BTN_STYLE = """
    QPushButton {
        padding: 6px; font-size: 11px;
        background-color: #ecf0f1; color: #2c3e50;
        border: 1px solid #bdc3c7; border-radius: 4px;
    }
    QPushButton:hover { background-color: #d5dbdb; }
    QPushButton:disabled { color: #95a5a6; }
"""
STEP_STYLE = "font-size: 12px; font-weight: bold; color: #2c3e50; padding-top: 4px;"
HELP_STYLE = "color: #7f8c8d; font-size: 10px;"
NOTICE_STYLES = {
    "info":  "background-color: #ebf5fb; color: #1b4f72; border: 1px solid #aed6f1;",
    "ok":    "background-color: #e9f7ef; color: #186a3b; border: 1px solid #a9dfbf;",
    "warn":  "background-color: #fef9e7; color: #7d6608; border: 1px solid #f9e79f;",
    "error": "background-color: #fdedec; color: #922b21; border: 1px solid #f5b7b1;",
}
NOTICE_MARKS = {"info": "", "ok": "✔ ", "warn": "! ", "error": "✖ "}


def parse_recipients(text):
    """한 줄에 하나(쉼표 구분도 됨). 엑셀에서 여러 열을 복사하면 첫 칸만 쓴다."""
    names = []
    for line in (text or "").splitlines():
        cells = [line.split("\t")[0]] if "\t" in line else line.split(",")
        for name in (cell.strip() for cell in cells):
            if name and name not in HEADER_WORDS and name not in names:
                names.append(name)
    return names


class EdufineWorker(QThread):
    """공문 작성 창 조작·AI 호출을 별도 스레드에서 실행한다 (수신처는 수십 초 걸릴 수 있음)."""

    finished_ok = pyqtSignal(object)
    failed = pyqtSignal(str)

    def __init__(self, fn, *args, parent=None):
        super().__init__(parent)
        self.fn = fn
        self.args = args

    def run(self):
        pythoncom.CoInitialize()  # 이 스레드에서 공문 작성 창(COM)에 붙기 위해 필요
        try:
            self.finished_ok.emit(self.fn(*self.args))
        except draft_window.EdufineError as e:
            self.failed.emit(f"{e} ({e.detail})" if e.detail else str(e))
        except RuntimeError as e:
            self.failed.emit(str(e))
        except Exception as e:
            self.failed.emit(f"예상하지 못한 문제가 생겼습니다: {type(e).__name__}: {e}")
        finally:
            pythoncom.CoUninitialize()


class GongmunPanel(QWidget):
    def __init__(self, host, parent=None):
        """host: settings dict 와 save_settings() 를 가진 메인 창."""
        super().__init__(parent)
        self.host = host
        self.worker = None
        self.action_buttons = []
        self._build_ui()
        self.refresh_lists()

    # ============================================================
    # 화면 구성
    # ============================================================
    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(6)
        scroll.setWidget(content)
        outer.addWidget(scroll)

        layout.addWidget(self._help(
            "K-에듀파인 공문 작성 창을 열어 두고 쓰세요(문서관리 > 기안 > 공용서식에서 서식을 누르면 열립니다). "
            "AI 초안은 목록·AI 설정에서 고른 자체 AI 서버 또는 PenGPT 로만 보내고, 저장·결재올림은 직접 누릅니다. "
            "크롬의 PEN 브라우저에서 [공문작성 도우미로 보내기]를 누르면 ①칸이 저절로 채워집니다."))

        settings_btn = self._sub_button("⚙ 목록·AI 설정", self.open_settings)
        layout.addWidget(settings_btn)

        # ① 초안
        layout.addWidget(self._step("① 어떤 공문인가요?"))
        self.request_edit = QPlainTextEdit()
        self.request_edit.setPlaceholderText("예) 11월 산업안전보건 현장연수 참가 협조 요청, 대상 공업계열 15교, 11. 20.(목) 14:00")
        self.request_edit.setFixedHeight(64)
        layout.addWidget(self.request_edit)
        self.draft_btn = self._main_button("🤖 AI로 초안 만들기", self.make_draft)
        layout.addWidget(self.draft_btn)

        layout.addWidget(QLabel("제목"))
        self.title_edit = QLineEdit()
        self.title_edit.setPlaceholderText("공문 제목")
        layout.addWidget(self.title_edit)
        layout.addWidget(QLabel("본문"))
        self.body_edit = QPlainTextEdit()
        self.body_edit.setPlaceholderText("1. 관련: ...\n2. ...  끝.")
        self.body_edit.setMinimumHeight(120)
        layout.addWidget(self.body_edit)

        # ② 결재선·과제카드·수신처
        layout.addWidget(self._step("② 결재선·과제카드·수신처"))
        self.lists_help = self._help("")
        layout.addWidget(self.lists_help)
        layout.addWidget(self._sub_button("↻ 내 결재선·과제카드 가져오기 (K-에듀파인)", self.fetch_edufine_lists))
        layout.addWidget(QLabel("결재선 (나의 결재선)"))
        self.appr_combo = QComboBox()
        layout.addWidget(self.appr_combo)
        layout.addWidget(QLabel("과제카드"))
        self.task_combo = QComboBox()
        self.task_combo.setEditable(True)
        layout.addWidget(self.task_combo)
        layout.addWidget(QLabel("수신처 (대외 발송일 때만)"))
        self.recipients_edit = QPlainTextEdit()
        self.recipients_edit.setPlaceholderText("한 줄에 하나. 그룹 이름이나 기관명\n예) 공업계열15교\n부산기계공업고등학교")
        self.recipients_edit.setFixedHeight(64)
        layout.addWidget(self.recipients_edit)
        layout.addWidget(self._help("개인수신그룹·공용그룹 이름은 그룹째로 넣고, 그 밖의 이름은 조직도에서 검색해 넣습니다."))

        # ③ 넣기
        layout.addWidget(self._step("③ 공문 작성 창에 넣기"))
        self.fill_btn = self._main_button("▶ 제목·본문 넣기", self.fill_text)
        layout.addWidget(self.fill_btn)
        grid = QGridLayout()
        grid.setSpacing(4)
        grid.addWidget(self._sub_button("결재선 넣기", self.fill_approval), 0, 0)
        grid.addWidget(self._sub_button("과제카드 넣기", self.fill_task), 0, 1)
        grid.addWidget(self._sub_button("수신처 넣기", self.fill_recipients), 1, 0)
        grid.addWidget(self._sub_button("창 확인", self.check_window), 1, 1)
        layout.addLayout(grid)

        self.notice = QLabel("")
        self.notice.setWordWrap(True)
        self.notice.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.notice.hide()
        layout.addWidget(self.notice)
        layout.addStretch()

    def _step(self, text):
        label = QLabel(text)
        label.setStyleSheet(STEP_STYLE)
        return label

    def _help(self, text):
        label = QLabel(text)
        label.setWordWrap(True)
        label.setStyleSheet(HELP_STYLE)
        return label

    def _main_button(self, text, slot):
        button = QPushButton(text)
        button.setStyleSheet(MAIN_BTN_STYLE)
        button.clicked.connect(slot)
        self.action_buttons.append(button)
        return button

    def _sub_button(self, text, slot):
        button = QPushButton(text)
        button.setStyleSheet(SUB_BTN_STYLE)
        button.clicked.connect(slot)
        self.action_buttons.append(button)
        return button

    def show_notice(self, kind, text):
        self.notice.setStyleSheet(f"{NOTICE_STYLES[kind]} border-radius: 4px; padding: 6px; font-size: 11px;")
        self.notice.setText(NOTICE_MARKS[kind] + text)
        self.notice.show()

    def refresh_lists(self):
        settings = self.host.settings
        current_line = self.appr_combo.currentData()
        self.appr_combo.clear()
        for label, people in parse_approval_lines(settings.get("appr_lines", "")):
            text = f"{label} ({' → '.join(people)})" if people else label
            self.appr_combo.addItem(text, label)
        index = self.appr_combo.findData(current_line)
        if index >= 0:
            self.appr_combo.setCurrentIndex(index)

        current_card = self.task_combo.currentText()
        self.task_combo.clear()
        self.task_combo.addItem("")
        for card in parse_task_cards(settings.get("task_cards", "")):
            self.task_combo.addItem(card["name"])
        self.task_combo.setCurrentText(current_card)

        empty = self.appr_combo.count() == 0 or self.task_combo.count() <= 1
        self.lists_help.setText(
            "결재선·과제카드 목록이 비어 있습니다. 아래 [가져오기]를 누르면 K-에듀파인에서 내 목록을 읽어 옵니다."
            if empty else "목록이 바뀌었으면 [가져오기]로 다시 읽어 오세요.")

    # ============================================================
    # 실행 공통
    # ============================================================
    def _run(self, busy_text, fn, args, on_done):
        """작업 중에는 버튼을 잠가 두 번 눌리지 않게 한다."""
        for button in self.action_buttons:
            button.setEnabled(False)
        self.show_notice("info", f"{busy_text} 공문 작성 창을 건드리지 말고 기다려 주세요.")
        self.worker = EdufineWorker(fn, *args, parent=self)
        self.worker.finished_ok.connect(on_done)
        self.worker.failed.connect(lambda message: self.show_notice("error", message))
        self.worker.finished.connect(self._unlock)
        self.worker.start()

    def _unlock(self):
        for button in self.action_buttons:
            button.setEnabled(True)

    # ============================================================
    # 버튼 동작
    # ============================================================
    def open_settings(self):
        dialog = SettingsDialog(self.host.settings, self)
        if dialog.exec_() != QDialog.Accepted:
            return
        self.host.settings.update(dialog.get_values())
        self.host.save_settings()
        self.refresh_lists()
        self.show_notice("ok", "목록·AI 설정을 저장했습니다.")

    def fetch_edufine_lists(self):
        self._run("K-에듀파인에서 나의 결재선·과제카드를 읽는 중입니다(공문 작성 창이면 과제카드 선택 창이 잠깐 열렸다 닫힙니다).",
                  fetch_lists, (self.host.pen_bridge,), self._on_lists)

    def _on_lists(self, result):
        settings = self.host.settings
        if result["lines"]:
            settings["appr_lines"] = merge_appr_lines(settings.get("appr_lines", ""), result["lines"])
        if result["cards"]:
            settings["task_cards"] = merge_task_cards(settings.get("task_cards", ""), result["cards"])
        self.host.save_settings()
        self.refresh_lists()
        missing = [name for name, values in (("결재선", result["lines"]), ("과제카드", result["cards"])) if not values]
        text = (f"{' · '.join(result['sources'])}에서 결재선 {len(result['lines'])}개, "
                f"과제카드 {len(result['cards'])}개를 가져와 목록에 넣었습니다.")
        if missing:
            self.show_notice("warn", f"{text}\n{'·'.join(missing)}은(는) 찾지 못했습니다. "
                                     "K-에듀파인 공문 작성 창을 연 뒤 다시 누르면 그 창에서 읽어 옵니다.")
        else:
            self.show_notice("ok", text)

    def receive_request(self, request_text):
        """PEN 브라우저가 보낸 내용을 ①칸에 채운다. AI 호출은 사용자가 확인한 뒤 누른다."""
        self.request_edit.setPlainText(request_text)
        self.request_edit.setFocus()
        self.show_notice("info", "PEN 브라우저에서 내용을 받았습니다. ①칸을 확인한 뒤 [AI로 초안 만들기]를 눌러 주세요.")

    def make_draft(self):
        request = self.request_edit.toPlainText().strip()
        settings = self.host.settings
        if not request:
            self.show_notice("warn", "'어떤 공문인가요?' 칸에 내용을 먼저 적어 주세요.")
            return
        ask = self._make_asker()
        if ask is None:
            return
        self._run("AI가 공문을 쓰는 중입니다(30초~1분).", request_draft,
                  (ask, request, settings, settings.get("task_cards", "")),
                  self._on_draft)

    def _make_asker(self):
        """설정에서 고른 AI 에 묻는 함수. 준비가 안 됐으면 안내하고 None."""
        settings = self.host.settings
        if settings.get("ai_provider") == "pengpt":
            if not self.host.pen_bridge.panel_alive():
                self.show_notice("warn", "PenGPT 를 쓰려면 크롬에서 PEN 브라우저 패널을 열어 두세요"
                                         "(PenGPT 탭도 로그인해 열어 둔 채). 패널이 열려 있으면 몇 초 뒤 다시 눌러 주세요.")
                return None
            return self.host.pen_bridge.ask_pengpt
        if not settings.get("ollama_url") or not settings.get("ollama_model"):
            self.show_notice("warn", "⚙ 목록·AI 설정에서 자체 AI 서버 주소와 모델을 먼저 정해 주세요.")
            return None
        return ollama_asker(settings["ollama_url"], settings["ollama_model"])

    def _on_draft(self, draft):
        self.title_edit.setText(draft["title"])
        self.body_edit.setPlainText(draft["body"])
        if draft["taskCard"]:
            self.task_combo.setCurrentText(draft["taskCard"])
        self.show_notice("ok", "초안을 만들었습니다. 내용을 확인하고 필요한 곳을 고친 뒤 ③에서 넣어 주세요.")

    def fill_text(self):
        title = self.title_edit.text().strip()
        body = self.body_edit.toPlainText().strip()
        if not title and not body:
            self.show_notice("warn", "넣을 제목·본문이 없습니다. ①에서 먼저 작성해 주세요.")
            return
        self._run("제목·본문을 넣는 중입니다.", draft_window.fill_draft, (title, body),
                  lambda _: self.show_notice("ok", "제목·본문을 넣었습니다. 공문 작성 창에서 눈으로 확인한 뒤 저장해 주세요."))

    def fill_approval(self):
        label = self.appr_combo.currentData()
        if not label:
            self.show_notice("warn", "결재선 목록이 비어 있습니다. ②의 [내 결재선·과제카드 가져오기]를 먼저 눌러 주세요.")
            return
        self._run(f"나의 결재선 '{label}'을(를) 고르는 중입니다.", draft_window.set_appr_line, (label,),
                  lambda members: self.show_notice("ok", "결재선을 넣었습니다.\n" + "\n".join(members)))

    def fill_task(self):
        card = self.task_combo.currentText().strip()
        if not card:
            self.show_notice("warn", "②에서 과제카드를 먼저 골라 주세요.")
            return
        self._run("과제카드 선택 창에서 고르는 중입니다.", draft_window.set_task_card, (card,),
                  lambda picked: self.show_notice("ok", f"과제카드를 넣었습니다: {picked}"))

    def fill_recipients(self):
        names = parse_recipients(self.recipients_edit.toPlainText())
        if not names:
            self.show_notice("warn", "②의 수신처 칸에 그룹 이름이나 기관명을 먼저 적어 주세요.")
            return
        self._run(f"수신처 {len(names)}건을 넣는 중입니다(수십 초 걸릴 수 있음).",
                  draft_window.set_recipients, (names,), self._on_recipients)

    def _on_recipients(self, result):
        if result["missing"]:
            self.show_notice("warn",
                             f"수신자 {result['added']}곳을 넣었고, 아래 이름은 찾지 못했습니다.\n"
                             + "\n".join(result["missing"])
                             + "\n열려 있는 수신자지정 창에서 직접 추가한 뒤 [확인]을 눌러 주세요.")
        else:
            self.show_notice("ok", f"수신자 {result['added']}곳을 넣고 확인까지 눌렀습니다.")

    def check_window(self):
        self._run("공문 작성 창을 찾는 중입니다.", draft_window.draft_status, (), self._on_status)

    def _on_status(self, status):
        if status["message"]:
            self.show_notice("warn", f"{draft_window.ERROR_MESSAGES['MESSAGE_OPEN']}\n안내창 내용: {status['message']}")
        elif status["open"]:
            self.show_notice("ok", "공문 작성 창을 찾았습니다. ③의 버튼으로 넣을 수 있습니다.")
        else:
            self.show_notice("error", draft_window.ERROR_MESSAGES["NO_WINDOW"])
