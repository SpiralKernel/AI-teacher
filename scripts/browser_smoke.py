"""本机 Chrome 验证：独立数据库、禁用付费 API、桌面和手机宽度截图。"""
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8011"


def main():
    chrome = os.environ.get("CHROME_EXECUTABLE") or shutil.which("google-chrome-stable") or shutil.which("chromium")
    if not chrome:
        raise SystemExit("请先安装 Chrome，或通过 CHROME_EXECUTABLE 指定路径。")
    with tempfile.TemporaryDirectory(prefix="ai-teacher-browser-") as temp:
        db_path = Path(temp) / "browser.sqlite3"
        env = {**os.environ, "DATABASE_PATH": str(db_path), "DEEPSEEK_API_KEY": ""}
        process = subprocess.Popen([str(ROOT / ".venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", "8011", "--no-access-log"],
                                   cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            with httpx.Client(trust_env=False) as client:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError("临时服务启动失败：" + process.stderr.read().decode())
                    try:
                        if client.get(URL+"/api/v1/health").status_code == 200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(.1)
                else:
                    raise RuntimeError("临时服务启动超时")
            errors = []
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=chrome, headless=True, args=["--no-sandbox"])
                page = browser.new_page(viewport={"width":1440,"height":1100}, device_scale_factor=1)
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(URL)
                expect(page.get_by_role("heading", name="你的数学地图")).to_be_visible()
                expect(page.locator(".knowledge")).to_have_count(12)
                page.screenshot(path=ROOT/"docs/preview-desktop.png",full_page=True,animations="disabled")
                with page.expect_response("**/api/v1/practice/next") as response:
                    page.get_by_role("button",name="开始今日练习").click()
                attempt = response.value.json()
                with sqlite3.connect(db_path) as db:
                    q=json.loads(db.execute("SELECT data FROM questions WHERE id=?",(attempt["question"]["id"],)).fetchone()[0])
                expect(page.get_by_role("heading",name=q["stem"])).to_be_visible()
                page.get_by_label("你的答案",exact=True).fill("12345")
                page.get_by_role("button",name="给我一点提示").click()
                expect(page.locator(".hint-box")).to_be_visible()
                expect(page.get_by_label("你的答案",exact=True)).to_have_value("12345")
                page.get_by_label("你的答案",exact=True).fill("1/0")
                page.get_by_role("button",name="提交答案").click()
                expect(page.locator(".inline-error")).to_contain_text("分母不能为零")
                page.get_by_label("向学习伙伴提问").fill("先帮我想一小步。")
                page.get_by_role("button",name="一起想一想").click()
                expect(page.locator(".bubble").last).to_contain_text("当前使用题库提示")
                expect(page.get_by_label("你的答案",exact=True)).to_have_value("1/0")
                page.get_by_label("你的答案",exact=True).fill(q["answer"])
                page.get_by_role("button",name="提交答案").click()
                expect(page.get_by_role("heading",name="✓ 答对了，继续保持思考。")).to_be_visible()
                expect(page.locator(".result")).to_contain_text("使用过提示或辅导")
                page.screenshot(path=ROOT/"docs/preview-practice.png",full_page=True,animations="disabled")
                page.get_by_role("button",name="学习记录",exact=False).click()
                expect(page.locator(".record")).to_have_count(1)
                page.get_by_text("查看答案与解析").click()
                expect(page.locator("details")).to_contain_text(q["answer"])
                with page.expect_download() as download:
                    page.get_by_role("button",name="导出我的学习记录").click()
                assert download.value.suggested_filename=="AI-teacher-learning.json"
                page.get_by_role("button",name="学习地图",exact=False).click()
                page.set_viewport_size({"width":390,"height":844})
                expect(page.get_by_role("heading",name="你的数学地图")).to_be_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "手机页面存在横向溢出"
                page.screenshot(path=ROOT/"docs/preview-mobile.png",full_page=True,animations="disabled")
                page.get_by_role("button",name="开始今日练习").click()
                expect(page.get_by_label("你的答案",exact=True)).to_be_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "手机练习页面存在横向溢出"
                page.screenshot(path=ROOT/"docs/preview-mobile-practice.png",full_page=True,animations="disabled")
                assert not errors, errors
                browser.close()
            print("浏览器验证通过：桌面、390px 手机、提示草稿、非法答案、规则辅导、判分、历史解析、导出和无横向溢出。")
            print("截图：docs/preview-{desktop,practice,mobile,mobile-practice}.png；真实学习数据库未修改。")
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
