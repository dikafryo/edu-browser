"""공문작성 도우미 — 설정값과 경로, 설정 파일 읽기·쓰기."""
import json
import os
import sys

VERSION = "26.1028.9"
APP_NAME = f"공문작성 도우미 v{VERSION}"

# 교직원 업무도우미(크롬 확장) 연결 — bridge.py.
# 포트를 바꾸면 pen-browser/sidepanel.js 의 HELPER_URL 도 같이 바꿀 것.
# 확장 ID 는 pen-browser/manifest.json 의 "key" 로 고정된다(key 를 바꾸면 ID 도 바뀐다).
# 크롬 웹스토어 판은 웹스토어가 정한 다른 ID 를 받는다 — 게시하면 그 ID 를 여기에 더할 것.
PEN_BRIDGE_PORT = 47615
PEN_BROWSER_EXTENSION_IDS = ("opcbaabkeajnfochgbhhoklciiojapkp",)

# exe 로 묶었을 때는 exe 옆, 소스로 실행할 때는 gongmun-helper 폴더에 data/ 를 둔다
if getattr(sys, "frozen", False):
    APP_DIR = os.path.dirname(sys.executable)
else:
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(APP_DIR, "data")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")

DEFAULT_SETTINGS = {
    "org_name":     "",   # 기관·부서 (AI 초안에 넣는다)
    "ai_provider":  "ollama",  # "ollama"(자체 AI 서버) 또는 "pengpt"(교직원 업무도우미가 PenGPT 탭에 대신 물음)
    "ollama_url":   "",   # 공문 내용은 외부 AI 가 아닌 자체 AI 서버·PenGPT 로만 보낸다
    "ollama_model": "",
    "appr_lines":   "",   # '나의 결재선 이름: 사람, 사람' 한 줄에 하나
    "task_cards":   "",   # '과제카드명 | 관련 낱말' 한 줄에 하나
}


def load_settings():
    """파일이 없거나 망가졌으면 기본값으로 시작한다."""
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except (OSError, ValueError):
        saved = {}
    if not isinstance(saved, dict):
        saved = {}
    return {key: saved.get(key, default) for key, default in DEFAULT_SETTINGS.items()}


def save_settings(settings):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
