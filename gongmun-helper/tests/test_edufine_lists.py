"""나의 결재선·과제카드 가져오기 시험. 실행: python -m unittest discover -s tests"""
import unittest
from unittest import mock

from gongmun import edufine_lists


class FakeBridge:
    def __init__(self, alive=True, lists=None, error=None):
        self.alive = alive
        self.lists = lists or {"lines": [], "cards": []}
        self.error = error

    def panel_alive(self):
        return self.alive

    def ask_edufine_lists(self):
        if self.error:
            raise RuntimeError(self.error)
        return self.lists


class MergeTest(unittest.TestCase):
    def test_lines_keep_people_notes_and_follow_fetched_order(self):
        merged = edufine_lists.merge_appr_lines("관장: 지정이, 한수련\n옛 결재선", ["품의", "관장", "품의"])
        self.assertEqual(merged, "품의\n관장: 지정이, 한수련")

    def test_cards_keep_keywords(self):
        merged = edufine_lists.merge_task_cards("정보보안 | 보안, 점검", ["정보보안", "부서일반사무"])
        self.assertEqual(merged, "정보보안 | 보안, 점검\n부서일반사무")

    def test_bare_card_name(self):
        self.assertEqual(edufine_lists.bare_card_name("[단위과제] 정보보안 업무"), "정보보안 업무")
        self.assertEqual(edufine_lists.bare_card_name("정보보안"), "정보보안")


class FetchTest(unittest.TestCase):
    def fetch(self, bridge, draft_open=False, draft_lines=(), draft_cards=()):
        with mock.patch.object(edufine_lists.draft_window, "is_draft_open", return_value=draft_open), \
             mock.patch.object(edufine_lists.draft_window, "read_appr_lines", return_value=list(draft_lines)) as lines, \
             mock.patch.object(edufine_lists.draft_window, "read_task_cards", return_value=list(draft_cards)) as cards:
            return edufine_lists.fetch_lists(bridge), lines, cards

    def test_chrome_lists_are_enough(self):
        bridge = FakeBridge(lists={"lines": ["품의"], "cards": ["[단위과제] 정보보안"]})
        result, lines, cards = self.fetch(bridge, draft_open=True)
        self.assertEqual(result, {"lines": ["품의"], "cards": ["정보보안"], "sources": ["크롬 K-에듀파인"]})
        lines.assert_not_called()
        cards.assert_not_called()  # 크롬에서 다 얻으면 과제카드 선택 창을 열지 않는다

    def test_draft_window_fills_only_what_chrome_missed(self):
        bridge = FakeBridge(lists={"lines": ["품의"], "cards": []})
        result, lines, _ = self.fetch(bridge, draft_open=True, draft_cards=["부서일반사무"])
        self.assertEqual(result["cards"], ["부서일반사무"])
        self.assertEqual(result["sources"], ["크롬 K-에듀파인", "공문 작성 창"])
        lines.assert_not_called()

    def test_closed_panel_uses_draft_window(self):
        result, _, _ = self.fetch(FakeBridge(alive=False), draft_open=True, draft_lines=["관장"], draft_cards=["가"])
        self.assertEqual((result["lines"], result["sources"]), (["관장"], ["공문 작성 창"]))

    def test_nothing_found_explains_both_ways(self):
        with self.assertRaises(RuntimeError) as caught:
            self.fetch(FakeBridge(error="크롬에서 K-에듀파인 탭을 찾지 못했습니다."))
        self.assertIn("공문 작성 창", str(caught.exception))
        self.assertIn("K-에듀파인 탭을 찾지 못했습니다", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
