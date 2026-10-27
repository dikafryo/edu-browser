@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "venv\Scripts\pythonw.exe" (
  echo 처음 실행이라 필요한 프로그램을 설치합니다. 1~2분 걸립니다...
  python -m venv venv || goto :nopython
  venv\Scripts\python.exe -m pip install -q -r requirements.txt || goto :failed
)
start "" "venv\Scripts\pythonw.exe" -m gongmun
exit /b 0

:nopython
echo [실패] 파이썬을 찾지 못했습니다. python.org 에서 Python 3 를 설치한 뒤 다시 실행해 주세요.
pause
exit /b 1

:failed
echo [실패] 설치하지 못했습니다. 인터넷 연결을 확인한 뒤 venv 폴더를 지우고 다시 실행해 주세요.
pause
exit /b 1
