"""공문 초안 AI — 자체 AI 서버(Ollama) 또는 교육청 PenGPT 로만 보낸다.

공문 요청에는 업무 내용이 들어가므로 외부 AI(Claude·ChatGPT·Gemini 등)로는 보내지 않는다.
PenGPT 는 연결용 주소(API)가 없어서, 교직원 업무도우미(크롬 확장)가 열어 둔 PenGPT 탭에 대신 묻는다(bridge.py).
"""
import json
from datetime import datetime, timedelta, timezone

DRAFT_TIMEOUT_SEC = 300      # 맥북 모델은 30초~수 분 걸릴 수 있다
AI_PROVIDERS = {"ollama": "자체 AI 서버 (Ollama)", "pengpt": "교육청 PenGPT (교직원 업무도우미 통해)"}
DRAFT_CONTEXT_TOKENS = 16384  # Ollama 기본값(2천~4천 토큰)으로는 긴 요청이 잘린다
KST = timezone(timedelta(hours=9))
WEEKDAYS = "월화수목금토일"

DRAFT_SYSTEM_PROMPT = "\n".join([
    "너는 대한민국 교육청·학교의 공문서 작성을 돕는 비서다. 행정업무운영편람의 공문서 작성 원칙을 따른다.",
    "규칙:",
    "- 항목 기호는 1. → 가. → 1) → 가) → (1) → (가) 순서로 쓰고, 하위 항목은 띄어쓰기 2칸씩 들여쓴다.",
    "- 날짜는 2026. 10. 27.(화), 시각은 14:00 처럼 쓴다.",
    "- 금액은 금15,000원(금일만오천원) 처럼 쓴다.",
    "- 관련 근거가 있으면 본문을 \"1. 관련: ...\" 으로 시작한다.",
    "- 붙임이 있으면 본문 다음 줄에 \"붙임  1. 파일명 1부.\" 형식으로 쓴다. 붙임이 하나면 번호 없이 쓴다.",
    "- 문서 맨 끝(붙임이 있으면 마지막 붙임 뒤)에 띄어쓰기 2칸 후 \"끝.\"을 붙인다.",
    "- 쉬운 말과 간결한 개조식 문장으로 쓰고, 입력에 없는 사실은 지어내지 않는다. 모르는 값은 ○○로 남긴다.",
    "- 제목은 내용을 한눈에 알 수 있게 짧게 쓴다.",
    "반드시 아래 JSON 하나만 출력한다. 본문 줄바꿈은 \\n 으로 쓴다.",
    '{"title":"제목","body":"본문","taskCard":"과제카드 목록 중 가장 알맞은 이름, 없으면 빈 문자열"}',
])


def today_text():
    now = datetime.now(KST)
    return f"{now.year}. {now.month}. {now.day}.({WEEKDAYS[now.weekday()]})"


def parse_task_cards(text):
    """'과제카드명 | 관련 낱말, 낱말' 줄 목록 → [{"name", "keywords"}]."""
    cards = []
    for line in (text or "").splitlines():
        name, _, keyword_text = line.partition("|")
        name = name.strip()
        if name:
            keywords = [word.strip() for word in keyword_text.split(",") if word.strip()]
            cards.append({"name": name, "keywords": keywords})
    return cards


def suggest_task_card(text, cards):
    """AI 가 과제카드를 못 고르면 낱말이 가장 많이 겹치는 카드로 정한다."""
    best, best_score = "", 0
    for card in cards:
        score = sum(1 for word in [card["name"], *card["keywords"]] if word in text)
        if score > best_score:
            best, best_score = card["name"], score
    return best


def build_draft_prompt(request, settings, cards):
    lines = [f"오늘: {today_text()}"]
    if settings.get("org_name"):
        lines.append(f"기관·부서: {settings['org_name']}")
    if cards:
        lines.append("과제카드 목록: " + " / ".join(card["name"] for card in cards))
    lines.append(f"요청: {request}")
    return "\n".join(lines)


def extract_json(text):
    """모델이 앞뒤에 말을 덧붙여도 마지막으로 온전한 JSON 객체를 찾아낸다.

    strict=False: 모델이 본문 문자열 안에 \\n 대신 실제 줄바꿈을 넣는 경우가 많다.
    """
    text = (text or "").strip()
    decoder = json.JSONDecoder(strict=False)
    try:
        value = decoder.decode(text)
        if isinstance(value, dict):
            return value
    except ValueError:
        pass
    for start in range(text.rfind("{"), -1, -1):
        if text[start] != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[start:])
            if isinstance(value, dict):
                return value
        except ValueError:
            continue
    return None


def list_models(base_url):
    import requests
    resp = requests.get(f"{base_url.rstrip('/')}/api/tags", timeout=10)
    resp.raise_for_status()
    return [model["name"] for model in resp.json().get("models", [])]


def ollama_asker(base_url, model):
    """(system, user) → 답 글자. 실패하면 한국어 메시지의 RuntimeError."""
    import requests

    def ask(system, user):
        try:
            resp = requests.post(
                f"{base_url.rstrip('/')}/api/chat",
                timeout=DRAFT_TIMEOUT_SEC,
                json={
                    "model": model,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    "stream": False,
                    "format": "json",
                    "options": {"num_ctx": DRAFT_CONTEXT_TOKENS},
                },
            )
            resp.raise_for_status()
        except requests.exceptions.ConnectionError:
            raise RuntimeError("자체 AI 서버(Ollama)에 연결하지 못했습니다. 서버(맥북)가 켜져 있고 주소가 맞는지 확인해 주세요.")
        except requests.exceptions.Timeout:
            raise RuntimeError("AI 응답이 너무 오래 걸려 멈췄습니다. 더 작은 모델을 쓰거나 다시 시도해 주세요.")
        except requests.exceptions.HTTPError:
            raise RuntimeError(f"자체 AI 서버가 요청을 거절했습니다({resp.status_code}). 모델 이름을 확인해 주세요.")
        return resp.json().get("message", {}).get("content", "")

    return ask


def parse_draft(answer, request, cards):
    """AI 답 글자 → {"title", "body", "taskCard"}. 과제카드는 목록에 있는 이름만 쓴다."""
    result = extract_json(answer)
    if not result or not (result.get("title") or result.get("body")):
        raise RuntimeError("AI 답을 공문 형식으로 읽지 못했습니다. 한 번 더 눌러 주세요.")
    card_names = {card["name"] for card in cards}
    task_card = result.get("taskCard", "")
    if task_card not in card_names:
        task_card = suggest_task_card(f"{request} {result.get('title', '')}", cards)
    return {
        "title": str(result.get("title", "")).strip(),
        "body": str(result.get("body", "")).replace("\\n", "\n").strip(),
        "taskCard": task_card,
    }


def request_draft(ask, request, settings, task_card_text):
    """ask(system, user) 로 AI 에 묻고 {"title", "body", "taskCard"} 를 돌려준다."""
    cards = parse_task_cards(task_card_text)
    answer = ask(DRAFT_SYSTEM_PROMPT, build_draft_prompt(request, settings, cards))
    return parse_draft(answer, request, cards)
