"""교직원 업무도우미 패널 기능 시험.

실제 sidepanel.html 의 본문과 스크립트를 가짜 chrome API(stub_chrome.js)와 함께 headless 크롬으로 열고,
run_tests.js 의 결과를 읽어 보여 준다. 실패가 있으면 종료 코드 1.

    python tests/pen-browser/run.py
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "pen-browser"))
SCRIPTS = ["update.js", "sidepanel.js", "inbox.js", "neis.js", "diagnose.js"]  # sidepanel.html 과 같은 순서
CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def file_url(path):
    return "file:///" + path.replace("\\", "/")


def build_page(folder):
    with open(os.path.join(EXT_DIR, "sidepanel.html"), encoding="utf-8") as f:
        source = f.read()
    body = source[source.index("<body>") + len("<body>"): source.index("<script src=")]
    scripts = "".join(f'<script src="{file_url(os.path.join(EXT_DIR, name))}"></script>\n' for name in SCRIPTS)
    page = (
        '<!doctype html><html><head><meta charset="utf-8"></head><body>'
        f'{body}<pre id="testOut">START</pre>\n'
        f'<script src="{file_url(os.path.join(HERE, "stub_chrome.js"))}"></script>\n'
        f'{scripts}<script src="{file_url(os.path.join(HERE, "run_tests.js"))}"></script></body></html>'
    )
    path = os.path.join(folder, "panel_test.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(page)
    return path


def main():
    chrome = next((p for p in CHROME_PATHS if os.path.exists(p)), None)
    if not chrome:
        print("크롬(또는 엣지)을 찾지 못했습니다.")
        return 2
    folder = tempfile.mkdtemp(prefix="pen-test-")
    try:
        page = build_page(folder)
        result = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
             f"--user-data-dir={os.path.join(folder, 'profile')}", "--virtual-time-budget=20000",
             "--dump-dom", file_url(page)],
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        )
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    match = re.search(r'<pre id="testOut">(.*?)</pre>', result.stdout, re.S)
    report = html.unescape(match.group(1)) if match else "시험 결과를 읽지 못했습니다.\n" + result.stdout[-1000:]
    print(report)
    return 0 if "\nSUMMARY" in report and "FAIL" not in report and "CRASH" not in report else 1


if __name__ == "__main__":
    sys.exit(main())
