"""全科浏览器验证：独立数据库与模拟模型，不修改实际学习记录。"""
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

import httpx
from PIL import Image
from playwright.sync_api import expect, sync_playwright

from app.bank import import_records
from app.db import connect, initialize

ROOT=Path(__file__).resolve().parents[1]
URL="http://127.0.0.1:8014"


def fixtures():
    base={"subject":"math","stage":"junior","grade":None,"term":None,"options":[],"answer":"x=3",
          "kind":"reference","status":"reference","steps":["两边减去1，再除以2，x=3。"],"difficulty":2,"difficulty_raw":"一般",
          "knowledge_tags":["一元一次方程"],"type_tags":["解答题"],"derived_type_tags":["解答题 · 一元一次方程"],
          "tags_source":"source","has_missing_assets":False,"issues":[],"provenance":{"dataset":"本机测试","license":"原创","url":"https://example.com"}}
    yield {**base,"id":"bank:test:math-written","stem":"解方程 $2x+1=7$，写出完整步骤。"}
    yield {**base,"id":"bank:test:math-choice","stem":"方程 $2x+1=7$ 的解是（ ）。","kind":"single_choice","status":"ready","answer":"A","options":[{"key":"A","text":"$x=3$"},{"key":"B","text":"$x=4$"}]}
    yield {**base,"id":"bank:test:reading","subject":"chinese","stem":"阅读下面的文章，回答问题。\n\n"+"清晨的校园里，树叶在风中轻轻摇动。小林停下脚步，发现一株幼苗从石缝里长出。他想起老师说过，观察生活，需要耐心，也需要提出自己的问题。\n"*18+"\n（1）概括小林的发现。\n（2）结合原文，说明这次发现给他的启示。", "knowledge_tags":["文章内容概括","联系语境理解"],"type_tags":["阅读理解"],"derived_type_tags":["阅读理解 · 文章内容概括"],"answer":"发现石缝中的幼苗；学会耐心观察、主动提问。","steps":["先找出核心事件，再结合语句分析启示。"]}


class Provider(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        prompt=body['messages'][0]['content']
        if '评阅助手' in prompt:
            value={"transcribed_answer":"2x=6，所以 x=3。","verdict":"correct","reason":"过程和结论与参考一致。","steps_feedback":["两边减去1正确。","两边除以2，得到x=3。"],"confidence":"high","gaps":[],"proposed_types":[],"proposed_knowledge":[]}
        elif '标签目录选出' in prompt:
            context=json.loads(prompt.split('\n',1)[1]);value={"tag_id":context['tags'][0]['id'],"difficulty":2,"reason":"先从一元一次方程诊断，再按表现调整。"}
        else:value={"reply":"先找题目给出的等量关系，再一步一步检查。","check_question":"等式两边应同时减去多少？"}
        payload=json.dumps({"choices":[{"message":{"content":json.dumps(value,ensure_ascii=False)}}]}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)


def main():
    chrome=shutil.which('google-chrome-stable') or shutil.which('chromium')
    if not chrome:raise SystemExit('需要本机Chrome')
    provider=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='ai-teacher-bank-browser-') as temp:
        path=Path(temp)/'test.sqlite3';initialize(path)
        with connect(path) as db:import_records(db,'test',fixtures(),{'url':'https://example.com','license':'原创测试'})
        env={**os.environ,'DATABASE_PATH':str(path),'DEEPSEEK_API_KEY':'local-test-only','DEEPSEEK_BASE_URL':f'http://127.0.0.1:{provider.server_port}','NO_PROXY':'127.0.0.1,localhost'}
        process=subprocess.Popen([str(ROOT/'.venv/bin/uvicorn'),'app.main:app','--host','127.0.0.1','--port','8014','--no-access-log'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            with httpx.Client(trust_env=False) as client:
                for _ in range(100):
                    try:
                        if client.get(URL+'/api/v1/health').status_code==200:break
                    except httpx.ConnectError:pass
                    time.sleep(.1)
                else:raise RuntimeError(process.stderr.read().decode())
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(URL);page.get_by_role('button',name='全科题库',exact=False).click()
                expect(page.get_by_role('heading',name='把每一科，都学明白。')).to_be_visible()
                expect(page.get_by_role('heading',name='这个阶段，需要会什么')).to_be_visible()
                expect(page.locator('#course-targets')).to_contain_text('2024修订')
                page.get_by_label('学习阶段',exact=True).select_option('math-9-1')
                expect(page.locator('.bank-card')).to_have_count(0)
                page.reload();page.get_by_role('button',name='全科题库',exact=False).click()
                expect(page.get_by_label('学习阶段',exact=True)).to_have_value('math-9-1')
                page.get_by_label('学习阶段',exact=True).select_option('math-7-1')
                expect(page.locator('.bank-card')).to_have_count(2)
                page.get_by_label('当前学习单元',exact=True).select_option('math-7-1:u1')
                expect(page.locator('.bank-card')).to_have_count(0)
                page.get_by_label('当前学习单元',exact=True).select_option('math-7-1:u5')
                expect(page.locator('.bank-card')).to_have_count(2)
                page.screenshot(path=ROOT/'docs/preview-course-targets.png',full_page=True,animations='disabled')
                expect(page.locator('.bank-card')).to_have_count(2)
                assert page.locator('.katex').count()>0
                page.get_by_label('作答方式',exact=True).select_option('choice')
                expect(page.locator('.bank-card')).to_have_count(1)
                page.locator('.bank-card').get_by_role('button',name='开始作答').click()
                page.locator('.bank-option').first.click();page.get_by_role('button',name='提交答案',exact=True).click()
                expect(page.get_by_role('heading',name='已保存：正确')).to_be_visible()
                expect(page.locator('#bank-profile')).to_contain_text('已作答 1 题')
                page.get_by_label('作答方式',exact=True).select_option('written')
                expect(page.locator('.bank-card')).to_have_count(1)
                page.locator('.bank-card').get_by_role('button',name='开始作答').click()
                page.get_by_label('大题或阅读题解答').fill('两边减去1，得到2x=6，再除以2，x=3。')
                out=io.BytesIO();Image.new('RGB',(300,400),'white').save(out,'PNG')
                page.get_by_label('上传手写答案图片').set_input_files({'name':'answer.png','mimeType':'image/png','buffer':out.getvalue()})
                page.get_by_role('button',name='请 AI 检查解答').click()
                expect(page.get_by_role('heading',name='核对 AI 的评阅建议')).to_be_visible(timeout=15000)
                page.get_by_label('主观题核对结论').select_option('correct')
                page.get_by_text('我已对照自己的解答核对',exact=False).click()
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=ROOT/'docs/preview-bank-written.png',full_page=True,animations='disabled')
                page.get_by_role('button',name='确认评阅并保存').click()
                expect(page.get_by_role('heading',name='已保存：正确')).to_be_visible()
                page.get_by_role('button',name='让 AI 按标签选题').click()
                expect(page.locator('#bank-workspace')).to_contain_text('先从一元一次方程诊断')
                page.get_by_label('科目',exact=True).select_option('chinese')
                expect(page.locator('.bank-card')).to_have_count(1)
                page.locator('.bank-card').get_by_role('button',name='开始作答').click()
                expect(page.get_by_role('heading',name='阅读材料与问题')).to_be_visible()
                assert len(page.locator('.bank-stem').first.inner_text())>900
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=ROOT/'docs/preview-bank-reading.png',full_page=True,animations='disabled')
                page.set_viewport_size({'width':390,'height':844})
                expect(page.get_by_label('学习阶段',exact=True)).to_have_value('chinese-7-1')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'手机全科阅读页横向溢出'
                page.evaluate('window.scrollTo(0,0)');page.screenshot(path=ROOT/'docs/preview-bank-mobile.png',full_page=True,animations='disabled')
                page.get_by_role('button',name='拍照与试卷',exact=False).click()
                expect(page.get_by_role('heading',name='把纸上的题，带进学习空间。')).to_be_visible()
                assert not errors,errors
                browser.close()
            print('全科浏览器通过：标签筛选、公式、单选判分、手写上传与确认、AI标签选题、长阅读、390px布局和跨页面导航。')
        finally:
            process.terminate();process.wait(timeout=10);provider.shutdown();provider.server_close()


if __name__=='__main__':main()
