"""공문 초안 AI — 사용자가 설정에서 고른 무료 AI 서비스(OpenAI 호환)로만 보낸다.

공문 요청에는 업무 내용이 들어가므로 내용이 그 서비스로 전송된다. 화면에 그 사실을 알린다.
키는 이 PC 의 data/settings.json 에만 저장하고 로그에 남기지 않는다.
"""
import json
from datetime import datetime, timedelta, timezone

DRAFT_TIMEOUT_SEC = 300      # 긴 공문도 쓸 수 있게 넉넉히 기다린다

# 무료 AI 서비스 목록. pen-browser/sidepanel.js 의 AI_SERVICES 와 같은 내용으로 맞춘다.
AI_SERVICES = [
    {
        "id": "groq",
        "name": "Groq (무료·빠름)",
        "short_name": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-120b",
        "key_help": "console.groq.com/keys 에서 로그인 → Create API Key → 만든 키를 복사해 붙여넣으세요.",
        "data_note": "무료 등급이며 API 데이터를 학습에 쓰지 않는다고 밝히고 있습니다. 공문에 권합니다.",
    },
    {
        "id": "upstage",
        "name": "Upstage Solar (한국어 강함)",
        "short_name": "Upstage",
        "base_url": "https://api.upstage.ai/v1",
        "model": "solar-pro4",
        "key_help": "console.upstage.ai 에서 가입 → API Keys → 새 키 만들기 → 키를 복사해 붙여넣으세요.",
        "data_note": "API 데이터를 저장·학습하지 않는다고 밝히고 있습니다. 가입 크레딧과 교육기관 무료 프로그램이 있습니다.",
    },
    {
        "id": "openrouter",
        "name": "OpenRouter (여러 무료 모델)",
        "short_name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "google/gemma-4-31b-it:free",
        "key_help": "openrouter.ai/keys 에서 로그인 → Create Key → 키를 복사해 붙여넣으세요.",
        "data_note": "무료(:free) 모델만 씁니다. 모델마다 데이터 정책이 다르니 공문에는 Groq·Upstage를 권합니다.",
    },
    {
        "id": "gemini",
        "name": "Google Gemini (무료 등급)",
        "short_name": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-3.8-flash",
        "key_help": "aistudio.google.com/apikey 에서 Google 계정으로 로그인 → Create API key → 키를 복사해 붙여넣으세요.",
        "data_note": "무료 등급은 입력 내용이 Google 제품 개선에 쓰일 수 있어 공문·학생 정보에는 권하지 않습니다.",
    },
]


def service_for(provider):
    """설정에 저장된 서비스 id → 서비스 정보. 모르는 id 면 첫 서비스(Groq)."""
    return next((service for service in AI_SERVICES if service["id"] == provider), AI_SERVICES[0])


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


def api_asker(base_url, api_key, model):
    """(system, user) → 답 글자. 무료 AI 서비스의 /chat/completions 를 부른다."""
    import requests

    def ask(system, user):
        try:
            resp = requests.post(
                f"{base_url.rstrip('/')}/chat/completions",
                timeout=DRAFT_TIMEOUT_SEC,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "temperature": 0.3,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                },
            )
        except requests.exceptions.ConnectionError:
            raise RuntimeError("AI API에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.")
        except requests.exceptions.Timeout:
            raise RuntimeError("AI 응답이 너무 오래 걸려 멈췄습니다. 내용을 줄이거나 다시 시도해 주세요.")
        if resp.status_code in (401, 403):
            raise RuntimeError("API 키가 맞지 않거나 권한이 없습니다. ⚙ 목록·AI 설정에서 키를 확인해 주세요.")
        if resp.status_code == 404:
            raise RuntimeError("AI 서비스에서 모델을 찾지 못했습니다. 다른 서비스를 고르거나 잠시 뒤 다시 시도해 주세요.")
        if resp.status_code == 429:
            raise RuntimeError("무료 사용량을 다 썼습니다. 잠시 뒤 또는 내일 다시 시도해 주세요.")
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError:
            raise RuntimeError(f"AI API가 요청을 거절했습니다({resp.status_code}). 잠시 후 다시 시도해 주세요.")
        try:
            choice = (resp.json().get("choices") or [])[0]
        except (ValueError, IndexError):
            raise RuntimeError("AI API의 답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.")
        return (choice.get("message") or {}).get("content") or ""

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
