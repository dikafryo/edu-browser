"""목록·AI 설정 다이얼로그.

기관·부서, 결재선 목록, 과제카드 목록, AI(자체 AI 서버 또는 PenGPT)를 한 화면에서 고친다.
값은 data/settings.json 에 저장된다(PC 안에만 남음).
"""
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QPushButton, QLabel, QWidget,
    QLineEdit, QComboBox, QPlainTextEdit, QDialogButtonBox, QMessageBox, QRadioButton, QButtonGroup,
)
from PyQt5.QtCore import Qt

from gongmun.draft_ai import AI_PROVIDERS, list_models

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

        layout.addWidget(QLabel("<b>AI</b> — 공문 초안을 누구에게 맡길까요?"))
        self.provider_group = QButtonGroup(self)
        self.provider_radios = {}
        for key, label in AI_PROVIDERS.items():
            radio = QRadioButton(label)
            self.provider_group.addButton(radio)
            self.provider_radios[key] = radio
            layout.addWidget(radio)
        saved_provider = settings.get("ai_provider", "ollama")
        self.provider_radios.get(saved_provider, self.provider_radios["ollama"]).setChecked(True)

        self.ollama_box = QWidget()
        ollama_layout = QVBoxLayout(self.ollama_box)
        ollama_layout.setContentsMargins(0, 0, 0, 0)
        url_row = QHBoxLayout()
        url_row.addWidget(QLabel("주소:"))
        self.url_edit = QLineEdit(settings.get("ollama_url", ""))
        self.url_edit.setPlaceholderText("예) http://100.64.0.1:11434")
        url_row.addWidget(self.url_edit, 1)
        ollama_layout.addLayout(url_row)

        model_row = QHBoxLayout()
        model_row.addWidget(QLabel("모델:"))
        self.model_combo = QComboBox()
        self.model_combo.setEditable(True)
        saved_model = settings.get("ollama_model", "")
        if saved_model:
            self.model_combo.addItem(saved_model)
        model_row.addWidget(self.model_combo, 1)
        load_btn = QPushButton("모델 불러오기")
        load_btn.clicked.connect(self.load_models)
        model_row.addWidget(load_btn)
        ollama_layout.addLayout(model_row)
        ollama_layout.addWidget(self._help(
            "공문 요청은 이 주소의 자체 AI 서버(Ollama)로만 보냅니다(외부 AI 로 보내지 않음). "
            "추천 모델: exaone3.5:7.8b 또는 gemma3:12b"))
        layout.addWidget(self.ollama_box)

        self.pengpt_help = self._help(
            "크롬의 PEN 브라우저 패널이 열려 있는 동안, 패널이 열어 둔 PenGPT 탭에 대신 묻고 답을 가져옵니다. "
            "PenGPT 에 로그인한 탭을 열어 두고, PEN 브라우저 설정 > AI 연결 > PenGPT 에서 위치 지정을 한 번 해 두세요. "
            "내용이 교육청 PenGPT 로 전송됩니다.")
        layout.addWidget(self.pengpt_help)
        self.provider_group.buttonToggled.connect(self._show_provider)
        self._show_provider()

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

    def selected_provider(self):
        return next(key for key, radio in self.provider_radios.items() if radio.isChecked())

    def _show_provider(self, *args):
        use_ollama = self.selected_provider() == "ollama"
        self.ollama_box.setVisible(use_ollama)
        self.pengpt_help.setVisible(not use_ollama)

    def load_models(self):
        url = self.url_edit.text().strip()
        if not url:
            QMessageBox.warning(self, "안내", "자체 AI 서버(Ollama) 주소를 먼저 적어 주세요.")
            return
        try:
            models = list_models(url)
        except Exception:
            QMessageBox.warning(self, "연결 실패",
                                "자체 AI 서버(Ollama)에 연결하지 못했습니다. 서버(맥북)가 켜져 있고 주소가 맞는지 확인해 주세요.")
            return
        current = self.model_combo.currentText()
        self.model_combo.clear()
        self.model_combo.addItems(models)
        if current in models:
            self.model_combo.setCurrentText(current)
        QMessageBox.information(self, "완료", f"모델 {len(models)}개를 찾았습니다. 하나를 고른 뒤 저장을 눌러 주세요.")

    def get_values(self):
        return {
            "org_name": self.org_edit.text().strip(),
            "appr_lines": self.appr_edit.toPlainText().strip(),
            "task_cards": self.task_edit.toPlainText().strip(),
            "ai_provider": self.selected_provider(),
            "ollama_url": self.url_edit.text().strip().rstrip("/"),
            "ollama_model": self.model_combo.currentText().strip(),
        }
