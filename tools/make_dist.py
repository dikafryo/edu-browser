"""배포 파일 두 개를 dist/ 에 만든다.

    python tools/make_dist.py

1. 교직원업무도우미-웹스토어-v{버전}.zip — 크롬 웹스토어 개발자 대시보드에 올리는 확장 묶음.
   manifest.json 이 압축 파일 맨 위에 있어야 하고, 웹스토어는 "key" 항목을 받지 않으므로 빼고 넣는다.
   (key 는 압축해제 설치 때 확장 번호를 고정하려고 둔 것이라 폴더의 manifest 에는 그대로 둔다)
2. gongmun-helper.zip — neis.me 에 올리는 공문헬퍼. 풀면 gongmun-helper 폴더 하나가 나온다.
   가상환경(venv)·설정(data, 업무 정보가 들어 있다)·시험 코드·캐시는 넣지 않는다.

zipfile 은 한글 파일 이름(실행.bat 등)에 UTF-8 표시를 달아 윈도우 탐색기에서도 깨지지 않는다.
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
EXTENSION_DIR = ROOT / "pen-browser"
HELPER_DIR = ROOT / "gongmun-helper"

# 압축해제 설치용 안내라 웹스토어 묶음에는 넣지 않는다
EXTENSION_SKIP = {"설치방법.txt"}
HELPER_FILES = ["실행.bat", "requirements.txt", "설치방법.txt"]


def store_manifest():
    manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text(encoding="utf-8"))
    manifest.pop("key", None)
    return manifest


def make_store_zip():
    manifest = store_manifest()
    target = DIST / f"교직원업무도우미-웹스토어-v{manifest['version']}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        # manifest.json 은 압축 파일 맨 앞에 둔다
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for path in sorted(EXTENSION_DIR.rglob("*")):
            relative = path.relative_to(EXTENSION_DIR).as_posix()
            if path.is_dir() or relative in EXTENSION_SKIP or relative == "manifest.json":
                continue
            archive.write(path, relative)
    return target


def make_helper_zip():
    target = DIST / "gongmun-helper.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in HELPER_FILES:
            archive.write(HELPER_DIR / name, f"gongmun-helper/{name}")
        for path in sorted((HELPER_DIR / "gongmun").glob("*.py")):
            archive.write(path, f"gongmun-helper/gongmun/{path.name}")
    return target


def main():
    DIST.mkdir(exist_ok=True)
    for target in (make_store_zip(), make_helper_zip()):
        with zipfile.ZipFile(target) as archive:
            names = archive.namelist()
        print(f"{target.relative_to(ROOT)}  ({len(names)}개 파일, {target.stat().st_size // 1024} KB)")
        for name in names:
            print(f"    {name}")


if __name__ == "__main__":
    main()
