"""목록 해석·AI 답 읽기·설정 파일 시험. 실행: python -m unittest discover -s tests"""
import json
import os
import tempfile
import unittest
from unittest import mock

from gongmun import config
from gongmun.draft_ai import build_draft_prompt, extract_json, parse_task_cards, suggest_task_card
from gongmun.panel import parse_approval_lines, parse_recipients


class ApprovalLineTest(unittest.TestCase):
    def test_label_and_people(self):
        self.assertEqual(parse_approval_lines("관장: 지정이, 한수련\n품의"),
                         [("관장", ["지정이", "한수련"]), ("품의", [])])

    def test_full_width_colon_and_blank_lines(self):
        self.assertEqual(parse_approval_lines("\n관：가\n\n"), [("관", ["가"])])


class RecipientTest(unittest.TestCase):
    def test_excel_columns_keep_first_cell_and_drop_header(self):
        pasted = "기관명\t주소\n부산기계공업고등학교\t부산\n공업계열15교\t-"
        self.assertEqual(parse_recipients(pasted), ["부산기계공업고등학교", "공업계열15교"])

    def test_commas_and_duplicates(self):
        self.assertEqual(parse_recipients("가학교, 나학교\n가학교"), ["가학교", "나학교"])


class TaskCardTest(unittest.TestCase):
    cards_text = "부서일반사무지원 | 일반, 사무\n특성화고노동인권교육 | 노동인권, 연수"

    def test_parse(self):
        cards = parse_task_cards(self.cards_text)
        self.assertEqual(cards[1], {"name": "특성화고노동인권교육", "keywords": ["노동인권", "연수"]})

    def test_suggest_by_keywords(self):
        cards = parse_task_cards(self.cards_text)
        self.assertEqual(suggest_task_card("노동인권 연수 안내", cards), "특성화고노동인권교육")
        self.assertEqual(suggest_task_card("관계없는 글", cards), "")


class ExtractJsonTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(extract_json('{"title": "가"}'), {"title": "가"})

    def test_text_around_and_real_newlines(self):
        answer = '알겠습니다.\n{"title": "가", "body": "1. 줄\n2. 줄"}\n끝'
        self.assertEqual(extract_json(answer)["body"], "1. 줄\n2. 줄")

    def test_no_json(self):
        self.assertIsNone(extract_json("답할 수 없습니다"))


class PromptTest(unittest.TestCase):
    def test_org_and_cards_in_prompt(self):
        prompt = build_draft_prompt("연수 안내", {"org_name": "부산○○고"}, parse_task_cards("일반사무 | 사무"))
        self.assertIn("기관·부서: 부산○○고", prompt)
        self.assertIn("과제카드 목록: 일반사무", prompt)
        self.assertIn("요청: 연수 안내", prompt)


class SettingsFileTest(unittest.TestCase):
    def test_missing_broken_and_round_trip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "settings.json")
            with mock.patch.object(config, "DATA_DIR", folder), mock.patch.object(config, "SETTINGS_FILE", path):
                self.assertEqual(config.load_settings(), config.DEFAULT_SETTINGS)
                with open(path, "w", encoding="utf-8") as f:
                    f.write("{망가진")
                self.assertEqual(config.load_settings(), config.DEFAULT_SETTINGS)
                settings = dict(config.DEFAULT_SETTINGS, org_name="부산○○고", unknown="버림")
                config.save_settings(settings)
                with open(path, encoding="utf-8") as f:
                    self.assertIn("부산○○고", f.read())  # ensure_ascii=False
                loaded = config.load_settings()
                self.assertEqual(loaded["org_name"], "부산○○고")
                self.assertNotIn("unknown", loaded)


if __name__ == "__main__":
    unittest.main()
