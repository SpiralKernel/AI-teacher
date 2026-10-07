"""试卷导入完整浏览器测试：真实上传/PDF/数据库，使用本机模拟 AI 避免费用。"""
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

import httpx
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import expect,sync_playwright

ROOT=Path(__file__).resolve().parents[1]
URL="http://127.0.0.1:8013"


class Provider(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        vision=isinstance(body["messages"][-1]["content"],list)
        if vision:
            content={"items":[
                {"label":"1","stem":"计算 -8 − (-7)。","student_answer":"-15","reference_answer":"-1","knowledge_ids":["addition"],"question_type_id":"template:addition","question_type_name":"负数减负数","suggested_verdict":"incorrect","confidence":"high","reason":"减去负数应改成加正数。","steps":["先改写为 -8+7。","结果为 -1。"]},
                {"label":"2","stem":"计算 |-7|。","student_answer":"7","reference_answer":"7","knowledge_ids":["absolute"],"question_type_id":"template:absolute","question_type_name":"负数的绝对值","suggested_verdict":"correct","confidence":"high","reason":"绝对值为到原点的距离。","steps":["距离不为负。","答案是 7。"]},
                {"label":"3","stem":"已知 x<0，求 |x|+|x-2| 的表达式。","student_answer":"[看不清]","reference_answer":"2-2x","knowledge_ids":["absolute"],"question_type_name":"两个绝对值和的分段化简","question_type_description":"由变量范围去绝对值并化简","suggested_verdict":"uncertain","confidence":"low","reason":"手写答案看不清，先核对。","steps":["根据符号拆绝对值。"]},
            ]}
        else:content={"reply":"减去一个负数，等于加上它的相反数。先把减法改写成加法。","check_question":"减去 -7 应当改写成加多少？"}
        payload=json.dumps({"choices":[{"message":{"content":json.dumps(content,ensure_ascii=False)}}]}).encode()
        self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(payload)));self.end_headers();self.wfile.write(payload)


def main():
    chrome=shutil.which("google-chrome-stable") or shutil.which("chromium")
    if not chrome:raise SystemExit("需要本机 Chrome")
    provider=ThreadingHTTPServer(("127.0.0.1",0),Provider)
    thread=threading.Thread(target=provider.serve_forever,daemon=True);thread.start()
    with tempfile.TemporaryDirectory(prefix="ai-teacher-import-browser-") as temp:
        env={**os.environ,"DATABASE_PATH":str(Path(temp)/"test.sqlite3"),"DEEPSEEK_API_KEY":"local-test-only",
             "DEEPSEEK_BASE_URL":f"http://127.0.0.1:{provider.server_port}","NO_PROXY":"127.0.0.1,localhost"}
        process=subprocess.Popen([str(ROOT/".venv/bin/uvicorn"),"app.main:app","--host","127.0.0.1","--port","8013","--no-access-log"],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            with httpx.Client(trust_env=False) as client:
                for _ in range(100):
                    if process.poll() is not None:raise RuntimeError(process.stderr.read().decode())
                    try:
                        if client.get(URL+"/api/v1/health").status_code==200:break
                    except httpx.ConnectError:pass
                    time.sleep(.1)
                else:raise RuntimeError("临时服务未启动")
            image=Image.new("RGB",(1100,900),"white")
            draw=ImageDraw.Draw(image);font=ImageFont.truetype("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",32)
            for index,text in enumerate(["已作答示例试卷","1. 计算 -8 - (-7)。","学生答案：-15","2. 计算 |-7|。","学生答案：7","3. 已知 x<0，求 |x|+|x-2|。","学生答案：（涂改不清）"]):draw.text((60,60+index*100),text,fill="black",font=font)
            pdf=io.BytesIO();image.save(pdf,"PDF")
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=chrome,headless=True,args=["--no-sandbox"])
                page=browser.new_page(viewport={"width":1440,"height":1000});errors=[]
                page.on("pageerror",lambda e:errors.append(str(e)))
                page.goto(URL);expect(page.get_by_role("heading",name="你的数学地图")).to_be_visible()
                page.get_by_role("button",name="拍照与试卷").click()
                page.get_by_label("选择试卷图片或PDF").set_input_files({"name":"已答试卷.pdf","mimeType":"application/pdf","buffer":pdf.getvalue()})
                page.get_by_role("button",name="上传并预览").click()
                expect(page.get_by_role("heading",name="页面已保存，准备识别")).to_be_visible(timeout=15000)
                expect(page.locator(".paper-preview img")).to_be_visible()
                page.get_by_role("button",name="发送至 AI，开始识别").click()
                expect(page.locator(".review-item")).to_have_count(3,timeout=25000)
                page.get_by_role("button",name="确认评价并生成报告").click()
                expect(page.locator("#confirmation-error")).to_contain_text("请逐题")
                for index,verdict in enumerate(["incorrect","correct","uncertain"]):
                    card=page.locator(".review-item").nth(index)
                    card.get_by_label("你的核对结论").select_option(verdict)
                    card.get_by_label("我已对照原页核对本题").check()
                page.evaluate("window.scrollTo(0,0)")
                page.screenshot(path=ROOT/"docs/preview-import-review.png",full_page=True,animations="disabled")
                page.get_by_role("button",name="确认评价并生成报告").click()
                expect(page.get_by_role("heading",name="从这份试卷，找到下一步。")).to_be_visible()
                expect(page.locator(".material-report")).to_contain_text("实际计入档案 2 题")
                page.locator(".review-item").first.get_by_role("button",name="问这一题").click()
                page.get_by_label("向AI提问拍照题").fill("我为什么不能写 -15？")
                page.get_by_role("button",name="讨论这一题").click()
                expect(page.locator("#material-chat .bubble").last).to_contain_text("减去一个负数")
                page.evaluate("window.scrollTo(0,0)")
                page.screenshot(path=ROOT/"docs/preview-import-report.png",full_page=True,animations="disabled")
                page.get_by_role("button",name="学习记录").click()
                expect(page.get_by_role("heading",name="题型画像")).to_be_visible()
                expect(page.locator(".type-profile")).to_contain_text("两个绝对值和的分段化简")
                expect(page.locator(".type-profile")).to_contain_text("AI 新建分类")
                page.screenshot(path=ROOT/"docs/preview-question-types.png",full_page=True,animations="disabled")
                page.set_viewport_size({"width":390,"height":844})
                assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
                page.get_by_role("button",name="拍照与试卷").click()
                expect(page.get_by_role("heading",name="从这份试卷，找到下一步。")).to_be_visible()
                assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
                page.screenshot(path=ROOT/"docs/preview-import-mobile.png",full_page=True,animations="disabled")
                page.once("dialog",lambda d:d.accept())
                page.get_by_role("button",name="删除材料及其掌握证据").click()
                expect(page.get_by_text("还没有导入材料。",exact=False)).to_be_visible()
                with httpx.Client(trust_env=False) as client:
                    assert client.get(URL+"/api/v1/student").json()["completed"]==0
                assert not errors,errors
                browser.close()
            print("试卷浏览器验证通过：PDF 原页、识别、逐题核对、报告、拍照问答、AI 新建题型、手机无溢出及删除撤销证据；无付费调用。")
        finally:
            process.terminate();process.wait(timeout=10);provider.shutdown();provider.server_close()


if __name__=="__main__":main()
