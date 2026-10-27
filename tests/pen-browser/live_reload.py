"""확장을 실제로 올려 새 판 반영(update.js)을 확인한다.

별도 headless 엣지(임시 프로필, 내 브라우저와 무관)에 확장을 압축해제로 올린다.
크롬 137 이후 정식판은 --load-extension 을 받지 않아 엣지를 쓴다(같은 Chromium 확장 API).

  A. 지금 판이 올라오고 패널이 오류 없이 뜨는지
  B. 폴더의 manifest 버전을 올리면 1분 안에 스스로 다시 불러오는지 (background 알람)
  C. 새 판 반영 기능이 없는 옛 판(태그 v26.1027.1)이 실행 중일 때, 폴더만 새 판으로 바꾸고
     패널을 한 번 열면 새 판이 되는지 — 사용자가 크롬 확장 화면에서 새로고침을 누르지 않아도 되는지

    pip install websocket-client
    python tests/pen-browser/live_reload.py          # 2~3분 걸린다
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

import websocket

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
EXT_SRC = os.path.join(REPO, "pen-browser")
EXT_ID = "opcbaabkeajnfochgbhhoklciiojapkp"  # manifest.json 의 key 로 정해진다
OLD_TAG = "v26.1027.1"
PORT = 9333
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


class Cdp:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=20, suppress_origin=True)
        self.count = 0

    def call(self, method, params=None):
        self.count += 1
        self.ws.send(json.dumps({"id": self.count, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.count:
                return message.get("result", {})

    def eval(self, expression):
        result = self.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
        return result.get("result", {}).get("value")

    def close(self):
        self.ws.close()


class Browser:
    def __init__(self, ext_dir):
        self.ext_dir = ext_dir
        self.profile = tempfile.mkdtemp(prefix="pen-live-")
        self.proc = subprocess.Popen(
            [EDGE, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={self.profile}",
             f"--load-extension={ext_dir}", "--no-first-run", "--no-default-browser-check", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            try:
                self.targets()
                break
            except OSError:
                time.sleep(0.5)
        time.sleep(3)

    def targets(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=5) as resp:
            return json.loads(resp.read())

    def worker_version(self):
        workers = [t for t in self.targets() if t.get("type") == "service_worker" and EXT_ID in t.get("url", "")]
        if not workers:
            return None
        cdp = Cdp(workers[0]["webSocketDebuggerUrl"])
        try:
            return cdp.eval("chrome.runtime.getManifest().version")
        finally:
            cdp.close()

    def open_panel(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=5) as resp:
            browser = Cdp(json.loads(resp.read())["webSocketDebuggerUrl"])
        target_id = browser.call("Target.createTarget", {"url": f"chrome-extension://{EXT_ID}/sidepanel.html"}).get("targetId")
        browser.close()
        for _ in range(30):
            page = [t for t in self.targets() if t.get("id") == target_id and t.get("webSocketDebuggerUrl")]
            if page:
                return Cdp(page[0]["webSocketDebuggerUrl"])
            time.sleep(0.3)
        return None

    def quit(self):
        self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def copy_current(target):
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(EXT_SRC, target)


# 윈도우 tar 는 한글 파일 이름(설치방법.txt)에서 멈추므로 파이썬 tarfile 로 푼다
def copy_old_tag(target):
    shutil.rmtree(target, ignore_errors=True)
    archive = subprocess.run(["git", "-C", REPO, "archive", OLD_TAG, "pen-browser"], capture_output=True, check=True).stdout
    parent = tempfile.mkdtemp(prefix="pen-old-")
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(parent, filter="data")
    shutil.move(os.path.join(parent, "pen-browser"), target)
    shutil.rmtree(parent, ignore_errors=True)


def set_version(ext_dir, version):
    path = os.path.join(ext_dir, "manifest.json")
    with open(path, encoding="utf-8") as f:
        manifest = json.load(f)
    manifest["version"] = version
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f" :: {detail}"))
    return ok


def scenario_current(ext_dir):
    copy_current(ext_dir)
    current = json.load(open(os.path.join(ext_dir, "manifest.json"), encoding="utf-8"))["version"]
    browser = Browser(ext_dir)
    try:
        results = [check("A. 확장이 올라옴", browser.worker_version() == current, browser.worker_version())]
        panel = browser.open_panel()
        time.sleep(3)
        info = panel.eval("({neis: !!document.getElementById('neisFillBtn'), majors: document.getElementById('neisMajor').options.length})")
        panel.close()
        results.append(check("A. 패널이 뜨고 나이스 입력칸이 채워짐", info and info["neis"] and info["majors"] > 0, info))
        set_version(ext_dir, "99.1231.1")
        changed = None
        for _ in range(20):
            time.sleep(5)
            changed = browser.worker_version()
            if changed == "99.1231.1":
                break
        results.append(check("B. 폴더 버전이 바뀌면 1분 안에 스스로 다시 불러옴", changed == "99.1231.1", changed))
        return all(results)
    finally:
        browser.quit()


def scenario_old_to_new(ext_dir):
    copy_old_tag(ext_dir)
    browser = Browser(ext_dir)
    try:
        old = browser.worker_version()
        copy_current(ext_dir)
        time.sleep(2)
        panel = browser.open_panel()
        time.sleep(5)
        new = browser.worker_version()
        return check(f"C. 옛 판({old})에서 패널을 한 번 열면 새 판이 됨", old == OLD_TAG[1:] and new not in (None, old), f"{old} -> {new}")
    finally:
        browser.quit()


def main():
    if not os.path.exists(EDGE):
        print("엣지를 찾지 못했습니다.")
        return 2
    ext_dir = os.path.join(tempfile.mkdtemp(prefix="pen-ext-"), "pen-browser")
    try:
        ok = scenario_current(ext_dir) & scenario_old_to_new(ext_dir)
    finally:
        shutil.rmtree(os.path.dirname(ext_dir), ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
