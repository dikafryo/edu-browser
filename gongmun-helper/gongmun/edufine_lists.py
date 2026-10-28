"""나의 결재선·과제카드 목록을 K-에듀파인에서 가져와 목록 설정에 합친다.

가져오는 곳은 두 군데다.
  1) 크롬 PEN 브라우저 → 열려 있는 K-에듀파인 탭의 화면 자료(Nexacro 데이터셋)에서 이름만 읽는다
  2) 열려 있는 공문 작성 창 → '나의 결재선' 콤보, 과제카드 선택 창(잠깐 열었다 [닫기])
1)에서 못 얻은 목록만 2)로 채운다. 목록 설정의 메모(결재할 사람, 관련 낱말)는 이름이 같으면 그대로 둔다.
"""
import re

from gongmun import draft_window
from gongmun.draft_ai import parse_task_cards

NOTHING_FOUND = ("결재선·과제카드를 가져오지 못했습니다. 크롬에서 PEN 브라우저 패널과 K-에듀파인 탭을 열어 두거나, "
                 "K-에듀파인 공문 작성 창(문서관리 > 기안 > 공용서식)을 연 뒤 다시 눌러 주세요.")


def parse_approval_lines(text):
    """'나의 결재선 이름: 사람, 사람' 줄 목록 → [(이름, [사람])]. 사람 이름은 확인용."""
    lines = []
    for line in (text or "").splitlines():
        label, colon, members = line.replace("：", ":").partition(":")
        label = label.strip()
        if label:
            people = [name.strip() for name in members.split(",") if name.strip()] if colon else []
            lines.append((label, people))
    return lines


def bare_card_name(name):
    """'[단위과제] 정보보안 업무' → '정보보안 업무'. 과제카드 넣기는 머리말이 없어도 찾는다."""
    return re.sub(r"^\[[^\]]*\]\s*", "", name).strip()


def _unique(names):
    seen = []
    for name in names:
        if name and name not in seen:
            seen.append(name)
    return seen


def merge_appr_lines(text, names):
    """가져온 결재선 이름 순서대로, 원래 적어 둔 '결재할 사람' 메모는 살린다."""
    people = dict(parse_approval_lines(text))
    return "\n".join(f"{name}: {', '.join(people[name])}" if people.get(name) else name for name in _unique(names))


def merge_task_cards(text, names):
    """가져온 과제카드 이름 순서대로, 원래 적어 둔 '관련 낱말'은 살린다."""
    keywords = {card["name"]: card["keywords"] for card in parse_task_cards(text)}
    return "\n".join(f"{name} | {', '.join(keywords[name])}" if keywords.get(name) else name for name in _unique(names))


def fetch_lists(bridge):
    """작업 스레드에서 부른다. {"lines", "cards", "sources"}. 둘 다 못 얻으면 한국어 메시지의 RuntimeError."""
    lines, cards, sources, problems = [], [], [], []
    if bridge.panel_alive():
        try:
            got = bridge.ask_edufine_lists()
            lines, cards = got["lines"], got["cards"]
            if lines or cards:
                sources.append("크롬 K-에듀파인")
        except RuntimeError as error:
            problems.append(str(error))
    if (not lines or not cards) and draft_window.is_draft_open():
        if not lines:
            lines = draft_window.read_appr_lines()
        if not cards:
            cards = draft_window.read_task_cards()
        sources.append("공문 작성 창")
    if not lines and not cards:
        raise RuntimeError("\n".join([NOTHING_FOUND, *problems]))
    return {"lines": _unique(lines), "cards": _unique(bare_card_name(card) for card in cards), "sources": sources}
