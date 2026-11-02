"""목록·AI 설정 다이얼로그.

기관·부서, 결재선 목록, 과제카드 목록, 무료 AI 서비스를 한 화면에서 고친다.
값은 data/settings.json 에 저장된다(PC 안에만 남음).
"""
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QComboBox,
    QPlainTextEdit, QDialogButtonBox,
)
from PyQt5.QtCore import Qt

from gongmun.draft_ai import AI_SERVICES, service_for

HELP_STYLE = "color: #7f8c8d; font-size: 11px;"


class SettingsDialog(QDialog):
    def __init__(self, settings, parent=None):
        super().__init__(parent)
        self.setWindowTitle("목록·AI 설정")
        self.setMinimumWidth(460)
        self.setWindowFlags(self.windowFlags() & ~Qt.WindowContextHelpButtonHint)

        layout = QVBoxLayout(self)

        layout.addWidget(QLabel("<b>기관·부서</b>"))
        self.org_edit = QLineEdit(settings.get("org_name", ""))
        self.org_edit.setPlaceholderText("예) 부산광역시교육청 ○○과 / 부산○○초등학교")
        layout.addWidget(self.org_edit)
        layout.addWidget(self._help("AI 가 공문 초안을 쓸 때 기관 이름으로 씁니다."))

        layout.addWidget(QLabel("<b>결재선 목록</b> — 한 줄에 하나 (나의 결재선 이름: 결재할 사람)"))
        self.appr_edit = QPlainTextEdit(settings.get("appr_lines", ""))
        self.appr_edit.setPlaceholderText("예)\n관장: 지정이, 한수련\n관: 지정이\n품의")
        self.appr_edit.setFixedHeight(90)
        layout.addWidget(self.appr_edit)
        layout.addWidget(self._help(
            "콜론(:) 앞 이름은 K-에듀파인 '나의 결재선' 이름과 똑같이 적습니다. "
            "뒤의 사람 이름은 확인용이라 비워도 됩니다. 맨 위 줄이 기본입니다. "
            "직접 적지 않아도 화면 ②의 [내 결재선·과제카드 가져오기]로 채울 수 있습니다."))

        layout.addWidget(QLabel("<b>과제카드 목록</b> — 한 줄에 하나 (과제카드명 | 관련 낱말)"))
        self.task_edit = QPlainTextEdit(settings.get("task_cards", ""))
        self.task_edit.setPlaceholderText("예)\n부서일반사무지원 | 일반, 사무\n특성화고노동인권교육 | 노동인권, 연수")
        self.task_edit.setFixedHeight(90)
        layout.addWidget(self.task_edit)
        layout.addWidget(self._help(
            "과제카드 선택 창에 나오는 단위과제카드 이름(대괄호 뒤 부분)으로 적습니다. "
            "AI 가 초안을 만들 때 이 목록에서 알맞은 카드를 골라 둡니다. "
            "[가져오기]로 채운 뒤 | 뒤에 관련 낱말을 덧붙이면 다시 가져와도 남습니다."))

        layout.addWidget(QLabel("<b>AI</b> — 공문 초안을 맡길 무료 AI 서비스"))
        self.api_keys = dict(settings.get("api_keys") or {})
        self.provider_combo = QComboBox()
        for service in AI_SERVICES:
            self.provider_combo.addItem(service["name"], service["id"])
        self.provider_combo.setCurrentIndex(max(0, self.provider_combo.findData(settings.get("ai_provider"))))
        layout.addWidget(self.provider_combo)

        self.key_help = self._help("")
        layout.addWidget(self.key_help)

        key_row = QHBoxLayout()
        key_row.addWidget(QLabel("API 키:"))
        self.api_key_edit = QLineEdit()
        self.api_key_edit.setEchoMode(QLineEdit.Password)
        self.api_key_edit.setPlaceholderText("공급자 사이트에서 발급받은 키")
        key_row.addWidget(self.api_key_edit, 1)
        layout.addLayout(key_row)

        self.data_note = self._help("")
        layout.addWidget(self.data_note)
        layout.addWidget(self._help(
            "공문의 업무 내용이 선택한 서비스로 전송됩니다. 무료 등급 중에는 학습에 쓰는 곳도 있으니 "
            "아래 안내를 확인하세요. 키는 이 PC 의 설정 파일에만 저장됩니다."))

        self._last_provider = ""
        self.provider_combo.currentIndexChanged.connect(self._show_service)
        self._show_service()

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.button(QDialogButtonBox.Save).setText("저장")
        buttons.button(QDialogButtonBox.Cancel).setText("취소")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _help(self, text):
        label = QLabel(text)
        label.setWordWrap(True)
        label.setStyleSheet(HELP_STYLE)
        return label

    def _current_service(self):
        return service_for(self.provider_combo.currentData())

    def _show_service(self, *args):
        # 서비스를 바꾸기 전에 입력하던 키를 그 서비스의 키로 남겨 둔다
        if self._last_provider:
            self.api_keys[self._last_provider] = self.api_key_edit.text().strip()
        service = self._current_service()
        self._last_provider = service["id"]
        self.api_key_edit.setText(self.api_keys.get(service["id"], ""))
        self.key_help.setText(service["key_help"])
        self.data_note.setText(service["data_note"])

    def get_values(self):
        service = self._current_service()
        self.api_keys[service["id"]] = self.api_key_edit.text().strip()
        return {
            "org_name": self.org_edit.text().strip(),
            "appr_lines": self.appr_edit.toPlainText().strip(),
            "task_cards": self.task_edit.toPlainText().strip(),
            "ai_provider": service["id"],
            "api_keys": {provider: key for provider, key in self.api_keys.items() if key},
        }
