"""当前学生浏览器验收：AI随时提问、即时求助、识图、学情/PDF与手机布局。"""
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
from PIL import Image
from playwright.sync_api import expect, sync_playwright

from app import bank
from app.db import connect, initialize

ROOT=Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]


class MockAI(BaseHTTPRequestHandler):
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        system=data['messages'][0]['content'];user=data['messages'][-1]['content']
        user=user if isinstance(user,str) else user[0]['text']
        if '模拟网络失败' in user:
            self.send_response(502);self.end_headers();return
        if '为家长生成' in system:
            value=json.loads(data['messages'][1]['content'])['learning_material'];notes=[e for e in value['evidence'] if e.get('quote')]
            focus=[{'type_id':notes[-1]['type_id'],'finding':'对话与已核对练习显示，绝对值的距离含义还值得进一步检查。','evidence_ids':[notes[-1]['id']]}] if notes else []
            content={'summary':f"本期有{value['summary']['questions']}次主动提问。请结合独立练习观察理解情况，提问本身不代表不会。",'strengths':[],'focus':focus,'parent_actions':['请孩子用数轴解释绝对值的含义。','先听推理，再核对答案。'],'next_steps':['独立尝试一道新的绝对值题。'],'uncertainty':'当前材料含对话和导入线索，不能替代充分的独立证据。'}
        elif '试卷识别助手' in system:
            content={'items':[{'label':'1','stem':'求-3的绝对值。','student_answer':'-3','reference_answer':'3','knowledge_ids':['absolute'],'question_type_id':'template:absolute','question_type_name':'负数的绝对值','suggested_verdict':'incorrect','confidence':'high','reason':'把距离写成了负数。','steps':['绝对值是到原点的距离。']}],'note':'已提取一道题。'}
        elif '独立的数学学习证据复核员' in system:
            value=json.loads(data['messages'][1]['content'])['learning_material']
            content={'decisions':[{'candidate_index':c['candidate_index'],'verdict':'supported','evidence_quote':c['evidence_quote'],'reason':'这段作答将距离写成了负数，需要纠正符号。'} for c in value['candidates']]}
        elif '学习评阅助手' in system:
            content={'transcribed_answer':'根据中点关系，AM=5。','verdict':'correct','reason':'中点把线段分成相等的两段。','confidence':'high'}
        else:
            value=json.loads(user);context=json.loads(data['messages'][1]['content'])['learning_material']
            confirmed=context.get('image_confirmed',False)
            quote=value['student_draft'][:100] if confirmed else value['message'][:100]
            content={'reply':'绝对值表示数轴上到原点的距离。距离不能是负数，所以要先看清数所在的位置。','check_question':'你能用距离解释-3的绝对值吗？','recognized_question':'求-3的绝对值。' if any(isinstance(m['content'],list) for m in data['messages']) else '',
              'transcribed_answer':'|-3|=-3' if any(isinstance(m['content'],list) for m in data['messages']) else '',
              'image_answer_status':'clear' if any(isinstance(m['content'],list) for m in data['messages']) else 'no_answer',
              'observations':[{'type_id':'m7a:absolute','type_name':'负数的绝对值','definition':'用距离解释绝对值。','goal_id':'math-7-1:u1:g3','kind':'difficulty' if confirmed else 'question_interest','evidence_source':'image_answer' if confirmed else 'message','evidence_quote':quote,'note':'正在了解绝对值的距离含义。'}]}
        payload=json.dumps({'choices':[{'message':{'content':json.dumps(content,ensure_ascii=False)}}]}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(payload)
    def log_message(self,*args):pass


def main():
    chrome=shutil.which('google-chrome-stable') or shutil.which('chromium')
    if not chrome:raise SystemExit('需要本机 Chrome')
    port,ai_port=free_port(),free_port();url=f'http://127.0.0.1:{port}'
    server=ThreadingHTTPServer(('127.0.0.1',ai_port),MockAI);threading.Thread(target=server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='ai-teacher-ui-') as temp:
        db_path=Path(temp)/'test.sqlite3';initialize(db_path)
        q={'id':'written','subject':'math','stage':'junior','grade':7,'term':1,'stem':'M 是线段 AB 的中点，AB=10cm，求 AM，并写出过程。','kind':'reference','status':'reference','options':[],
           'answer':'AM=5cm','steps':['中点将线段分成相等的两段。','AM=AB÷2=5cm。'],'difficulty':1,'knowledge_tags':['线段中点'],'type_tags':['线段中点关系求长度'],'tags_source':'source','provenance':{}}
        with connect(db_path) as db:bank.import_records(db,'browser',[q],{})
        env={**os.environ,'DATABASE_PATH':str(db_path),'AUTH_REQUIRED':'true','DEEPSEEK_API_KEY':'browser-test-only','DEEPSEEK_BASE_URL':f'http://127.0.0.1:{ai_port}'}
        process=subprocess.Popen([str(ROOT/'.venv/bin/uvicorn'),'app.main:app','--host','127.0.0.1','--port',str(port),'--no-access-log'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            with httpx.Client(trust_env=False) as client:
                for _ in range(100):
                    if process.poll() is not None:raise RuntimeError(process.stderr.read().decode())
                    try:
                        if client.get(url+'/api/v1/health').status_code==200:break
                    except httpx.ConnectError:pass
                    time.sleep(.1)
                else:raise RuntimeError('临时服务启动超时')
            errors=[]
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1050},accept_downloads=True)
                page.set_default_timeout(12000);page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url)
                expect(page.get_by_role('heading',name='建立你的学习空间')).to_be_visible()
                page.screenshot(path=ROOT/'docs/previews/preview-student-login-desktop.png',full_page=True,animations='disabled')
                page.get_by_label('用户名',exact=True).fill('browser_student');page.get_by_label('密码',exact=True).fill('test-pass-123');page.get_by_label('称呼',exact=True).fill('小林')
                page.get_by_role('button',name='创建并开始学习',exact=True).click()
                expect(page.get_by_role('heading',name='先从一个问题开始。')).to_be_visible();assert page.get_by_role('tab').count()==2
                assert page.request.get(url+'/api/v1/study/home').json()['completed']==0
                page.screenshot(path=ROOT/'docs/previews/preview-teacher-home-desktop.png',full_page=True,animations='disabled')
                page.get_by_label('向 AI 提问',exact=True).fill('绝对值为什么不能是负数？');page.get_by_role('button',name='发送问题',exact=True).click()
                expect(page.get_by_text('已记录 · 正在了解这个题型，尚未判断掌握情况。',exact=True)).to_be_visible()
                assert page.request.get(url+'/api/v1/study/home').json()['completed']==0
                page.get_by_label('拍照问题目',exact=True).set_input_files({'name':'question.png','mimeType':'image/png','buffer':png()})
                page.get_by_label('向 AI 提问',exact=True).fill('这道图片题如何理解？');page.get_by_role('button',name='发送问题',exact=True).click()
                expect(page.locator('.recognized-question').first).to_be_visible()
                page.get_by_text('核对图片中的作答',exact=True).click()
                page.get_by_label('核对图片题干',exact=True).fill('求-3的绝对值。')
                page.get_by_label('核对图片作答',exact=True).fill('|-3|=-3')
                page.get_by_role('button',name='确认作答并分析',exact=True).click()
                expect(page.get_by_text('图片作答已核对，后续讨论会参考核对后的内容。',exact=True)).to_be_visible()
                assert page.request.get(url+'/api/v1/study/home').json()['completed']==0
                page.screenshot(path=ROOT/'docs/previews/preview-teacher-chat-desktop.png',full_page=True,animations='disabled')
                page.get_by_label('向 AI 提问',exact=True).fill('模拟网络失败');page.get_by_role('button',name='发送问题',exact=True).click()
                expect(page.get_by_role('alert')).to_contain_text('AI 请求未完成');expect(page.get_by_label('向 AI 提问',exact=True)).to_have_value('模拟网络失败')
                page.get_by_role('button',name='新提问',exact=True).click()
                page.get_by_role('tab',name='题库',exact=True).click();page.get_by_role('button',name='开始练习',exact=True).click()
                expect(page.get_by_label('你的答案',exact=True)).to_be_visible();page.get_by_label('你的答案',exact=True).fill('-2')
                page.get_by_role('button',name='问问 AI',exact=True).click();expect(page.get_by_role('dialog',name='这道题的 AI老师')).to_be_visible()
                page.get_by_label('就这道题向 AI 提问',exact=True).fill('看看我这一步');page.get_by_role('button',name='发送问题',exact=True).click()
                expect(page.get_by_role('dialog').locator('.message').last).to_contain_text('绝对值表示')
                page.get_by_role('button',name='关闭问答',exact=True).click();expect(page.get_by_label('你的答案',exact=True)).to_have_value('-2')
                page.get_by_label('你的答案',exact=True).fill('1/0');page.get_by_role('button',name='提交答案',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('分母不能为零')
                expect(page.get_by_label('你的答案',exact=True)).to_have_value('1/0')
                page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.get_by_role('button',name='问问 AI',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=ROOT/'docs/previews/preview-teacher-drawer-mobile.png',full_page=False,animations='disabled')
                page.get_by_role('button',name='关闭问答',exact=True).click()
                page.get_by_label('作答方式',exact=True).select_option('written');page.get_by_role('button',name='继续练习',exact=True).click()
                expect(page.get_by_label('完整解答',exact=True)).to_be_visible();page.get_by_label('完整解答',exact=True).fill('由中点定义，AM=5。')
                page.get_by_label('上传手写答案',exact=True).set_input_files({'name':'answer.png','mimeType':'image/png','buffer':png()});page.get_by_role('button',name='提交 AI 评阅',exact=True).click()
                expect(page.get_by_role('heading',name='核对 AI 评阅')).to_be_visible();page.get_by_label('你确认的结果',exact=True).select_option('correct');page.get_by_text('我已核对图片转写与评价',exact=True).click();page.get_by_role('button',name='确认并保存',exact=True).click()
                expect(page.get_by_role('heading',name='这道题答对了。')).to_be_visible()
                page.get_by_role('tab',name='AI老师',exact=True).click();page.get_by_role('button',name='导入练习',exact=False).click();expect(page.get_by_role('heading',name='题目不用重新抄。')).to_be_visible()
                page.get_by_label('选择练习图片或PDF',exact=True).set_input_files({'name':'paper.png','mimeType':'image/png','buffer':png()});page.get_by_role('button',name='上传并预览',exact=True).click();page.get_by_role('button',name='开始识图',exact=True).click()
                expect(page.get_by_label('第1题题干',exact=True)).to_be_visible(timeout=15000);page.get_by_label('第1题评价',exact=True).select_option('incorrect');page.get_by_text('我已核对这道题',exact=True).click();page.get_by_role('button',name='保存核对结果',exact=True).click()
                expect(page.get_by_text('已保存核对结果，学习线索已更新。',exact=True)).to_be_visible()
                page.screenshot(path=ROOT/'docs/previews/preview-import-current-mobile.png',full_page=True,animations='disabled')
                page.get_by_role('button',name='学情报告',exact=True).click();expect(page.get_by_role('heading',name='学习，一步一步看得见。')).to_be_visible()
                expect(page.get_by_text('已结合学习证据',exact=True)).to_be_visible(timeout=15000);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=ROOT/'docs/previews/preview-parent-report-mobile.png',full_page=True,animations='disabled')
                page.set_viewport_size({'width':1440,'height':1050});page.screenshot(path=ROOT/'docs/previews/preview-parent-report-desktop.png',full_page=True,animations='disabled')
                with page.expect_download() as download:page.get_by_role('link',name='导出 PDF',exact=True).click()
                demo=ROOT/'tmp/pdfs/report-demo-data.json';demo.parent.mkdir(parents=True,exist_ok=True);demo.write_text(json.dumps(page.request.get(url+'/api/v1/reports').json(),ensure_ascii=False))
                path=ROOT/'output/pdf/student-report-demo.pdf';path.parent.mkdir(parents=True,exist_ok=True);download.value.save_as(path)
                assert path.read_bytes().startswith(b'%PDF')
                page.get_by_label('报告时间',exact=True).select_option('month');expect(page.get_by_text('小林 · 7年级上册数学 · 最近30天',exact=True)).to_be_visible()
                page.get_by_role('button',name='学习设置',exact=True).click();page.get_by_label('年级',exact=True).select_option('8');page.get_by_role('button',name='保存学习阶段',exact=True).click()
                expect(page.get_by_text('小林 · 8年级上册 · 数学',exact=True)).to_be_visible();expect(page.get_by_role('heading',name='先从一个问题开始。')).to_be_visible()
                assert page.request.get(url+'/api/v1/teacher/threads').json()['items']==[]
                page.get_by_role('button',name='退出',exact=True).click();expect(page.get_by_role('heading',name='欢迎回来')).to_be_visible()
                page.get_by_role('button',name='新建学生',exact=True).click();page.get_by_label('用户名',exact=True).fill('second_student');page.get_by_label('密码',exact=True).fill('test-pass-123');page.get_by_role('button',name='创建并开始学习',exact=True).click()
                expect(page.get_by_role('heading',name='先从一个问题开始。')).to_be_visible();assert page.request.get(url+'/api/v1/study/home').json()['completed']==0
                assert page.request.get(url+'/api/v1/teacher/threads').json()['items']==[]
                assert not errors,errors;browser.close()
            print('当前界面验收通过：零题答疑、拍照问题、自动学习线索、即时问答保留草稿、识图导入核对、AI学情/PDF导出、阶段及账号隔离、390px布局。')
        finally:process.terminate();process.wait(timeout=10);server.shutdown();server.server_close()


def png():
    out=io.BytesIO();Image.new('RGB',(220,150),'white').save(out,format='PNG');return out.getvalue()


if __name__=='__main__':main()
