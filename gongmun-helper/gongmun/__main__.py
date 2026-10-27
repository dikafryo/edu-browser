"""실행: python -m gongmun"""
import sys

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QApplication

from gongmun.main_window import MainWindow

QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
