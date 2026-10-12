"""隔离浏览器验收：后台标注、长题干、发布下载、学生入口与手机布局。"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time

import httpx
from playwright.sync_api import sync_playwright, expect

from app import bank
from app.admin import grant_admin
from app.db import connect, initialize

ROOT=Path(__file__).resolve().parents[1]


def main():
    output=ROOT/'output/evals/admin-ui';output.mkdir(parents=True,exist_ok=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    url=f'http://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory(prefix='admin-ui-') as temp:
        path=Path(temp)/'test.sqlite3';initialize(path)
        with connect(path) as db:
            multipart={'id':'ui:multipart','subject':'math','stage':'junior','grade':7,'term':1,'stem':'多问标注验收：（1）计算1+2；（2）计算3+4。',
                'kind':'reference','status':'reference','options':[],'answer':'（1）3；（2）7','steps':['1+2=3。','3+4=7。'],
                'difficulty':1,'knowledge_tags':['有理数加法'],'type_tags':['有理数加法求值'],'provenance':{'dataset':'ui-sample','source_id':'multi','license':'original'},
                'annotation':{'response_format':'composite','difficulty':{'level':1,'basis':'两次独立加法'},
                    'parts':[{'id':pid,'prompt':prompt,'reference_answer':answer,'rubric':[{'id':'calculate','description':'根据加法运算得到'+answer}]} for pid,prompt,answer in [('p1','计算1+2','3'),('p2','计算3+4','7')]]}}
            bank.import_records(db,'ui-sample',[multipart],{})
        with connect(path) as db:
            bank.import_records(db,'ui-sample',[{'id':'ui:long-reading','subject':'chinese','stage':'junior','grade':7,'term':1,
                'stem':'阅读下面的原创短文，结合文本回答问题。\n'+('清晨，孩子沿着河边走向学校。他停下来观察一片落叶，想起了昨天课堂上的问题。\n'*100),
                'kind':'reference','status':'reference','options':[],'answer':'结合描写说明人物的观察与思考。','steps':['先找出描写，再联系上下文解释。'],
                'difficulty':2,'knowledge_tags':['现代文阅读'],'type_tags':['人物描写作用的文本分析'],'tags_source':'source',
                'provenance':{'dataset':'ui-sample','source_id':'reading','license':'original'}}],{})
        env={**os.environ,'DATABASE_PATH':str(path),'AUTH_REQUIRED':'true','REGISTRATION_ENABLED':'true','REGISTRATION_REQUIRES_INVITE':'false','AI_API_KEY':'','DEEPSEEK_API_KEY':''}
        log=open(Path(temp)/'server.log','w')
        proc=subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(port),'--no-access-log'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        try:
            with httpx.Client(base_url=url,trust_env=False) as client:
                for _ in range(80):
                    try:
                        if client.get('/api/v1/health').status_code==200:break
                    except httpx.HTTPError:pass
                    time.sleep(.1)
                else:raise RuntimeError('临时服务启动失败')
                r=client.post('/api/v1/auth/register',json={'username':'maintenance-demo','password':'browser-test-123','grade':7,'term':1});assert r.status_code==201,r.text
            with connect(path) as db:grant_admin(db,'maintenance-demo')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=shutil.which('google-chrome-stable') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('dialog',lambda d:d.accept())
                page.goto(url+'/admin')
                page.get_by_label('用户名',exact=True).fill('maintenance-demo');page.get_by_label('密码',exact=True).fill('browser-test-123')
                page.get_by_role('button',name='登录工作台',exact=True).click()
                expect(page.get_by_role('heading',name='数据概览',exact=True)).to_be_visible()
                page.screenshot(path=str(output/'dashboard.png'),full_page=True)
                page.get_by_role('button',name='题目标注',exact=True).click()
                page.get_by_label('科目',exact=True).select_option('chinese')
                page.get_by_role('button',name='编辑 / 标注',exact=True).first.click()
                expect(page.get_by_label('题干 / 阅读材料',exact=True)).to_have_value('阅读下面的原创短文，结合文本回答问题。\n'+('清晨，孩子沿着河边走向学校。他停下来观察一片落叶，想起了昨天课堂上的问题。\n'*100))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=str(output/'long-reading.png'),full_page=True)
                page.get_by_role('button',name='＋ 新建题目',exact=True).click()
                expect(page.get_by_label('题干 / 阅读材料',exact=True)).to_have_value('')
                page.get_by_label('编辑年级',exact=True).select_option('7');page.get_by_label('编辑学期',exact=True).select_option('1')
                page.get_by_label('题干 / 阅读材料',exact=True).fill('求 $|-3|$ 的值。')
                page.get_by_label('作答形式',exact=True).select_option('single_choice')
                page.get_by_label('选项（每行 A|内容；过程题留空）',exact=True).fill('A|3\nB|-3')
                page.get_by_label('参考答案',exact=True).fill('A')
                page.get_by_label('解析步骤（每行一步）',exact=True).fill('绝对值表示距离，因此结果为3。')
                assert page.get_by_label('课程目标',exact=True).locator('option').count()>0, {'errors':errors,'fields':page.locator('.editor select').evaluate_all('(nodes)=>nodes.map(n=>({label:n.getAttribute("aria-label"),value:n.value,count:n.options.length}))')}
                page.get_by_label('课程目标',exact=True).select_option('math-7-1:u1:g3')
                page.get_by_label('知识点（每行一项）',exact=True).fill('绝对值')
                page.get_by_label('具体题型（每行一项）',exact=True).fill('负数的绝对值')
                page.get_by_label('难度判断依据',exact=True).fill('根据距离含义直接求绝对值。')
                page.get_by_label('启用完整标注',exact=True).check()
                page.get_by_label('完整作答形式',exact=True).select_option('single_choice')
                page.get_by_label('答案形式',exact=True).select_option('choice')
                page.get_by_label('答案等价规则',exact=True).select_option('exact')
                page.get_by_label('主要知识点',exact=True).fill('绝对值')
                page.get_by_label('细分题型',exact=True).fill('负数的绝对值')
                page.get_by_label('可接受答案（每行一项）',exact=True).fill('A')
                page.get_by_label('答案核验状态',exact=True).select_option('checked')
                page.get_by_label('我已核对小问、答案规则、得分点和待审问题。',exact=True).check()
                page.get_by_role('button',name='预览公式与排版',exact=True).click()
                expect(page.locator('.preview .katex')).to_have_count(1)
                page.get_by_role('button',name='保存草稿',exact=True).click()
                expect(page.locator('#admin-notice')).to_contain_text('草稿已保存')
                page.get_by_label('审核说明',exact=True).fill('人工核对绝对值定义、选项与课程目标。')
                page.get_by_label('我已核对题干、答案、解析、册次及题型标注。',exact=True).check()
                page.get_by_role('button',name='审核并发布',exact=True).click()
                expect(page.locator('#admin-notice')).to_contain_text('已发布题目新版本')
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(output/'editor.png'),full_page=True)
                page.get_by_role('button',name='题库更新',exact=True).click()
                page.get_by_role('button',name='发布题库更新包',exact=True).click()
                expect(page.locator('#admin-notice')).to_contain_text('已就绪')
                with page.expect_download() as download:
                    page.get_by_role('button',name='下载更新包',exact=True).click()
                downloaded=Path(download.value.path());package=json.loads(downloaded.read_text())
                assert any(item['family']=='bank' and item['data']['answer']=='A' for item in package['items'])
                page.get_by_role('button',name='题目标注',exact=True).click()
                page.get_by_label('题目来源',exact=True).select_option('original')
                page.get_by_label('科目',exact=True).select_option('math')
                expect(page.get_by_role('button',name='查看 / 复制',exact=True).first).to_be_visible()
                page.get_by_role('button',name='查看 / 复制',exact=True).first.click()
                page.get_by_role('button',name='复制为普通题草稿',exact=True).click()
                expect(page.get_by_label('题干 / 阅读材料',exact=True)).not_to_be_empty()
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(output/'mobile-editor.png'),full_page=True)
                page.get_by_role('button',name='← 返回题目列表',exact=True).click()
                page.get_by_label('题目来源',exact=True).select_option('bank')
                page.get_by_label('科目',exact=True).select_option('math')
                page.get_by_label('搜索题目',exact=True).fill('多问标注验收')
                page.get_by_role('button',name='搜索',exact=True).click()
                page.get_by_role('button',name='编辑 / 标注',exact=True).first.click()
                expect(page.get_by_label('启用完整标注',exact=True)).to_be_checked()
                expect(page.locator('.annotation-parts > details')).to_have_count(2)
                page.locator('.annotation-parts > details').nth(1).locator('summary').click()
                expect(page.get_by_label('本问参考答案',exact=True).nth(1)).to_have_value('7')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.locator('.annotation-editor').scroll_into_view_if_needed()
                page.screenshot(path=str(output/'multipart-editor-mobile.png'),full_page=True)
                page.goto(url)
                page.get_by_role('button',name='学习设置',exact=True).click()
                expect(page.get_by_role('link',name='打开题库工作台 →',exact=True)).to_be_visible()
                page.get_by_role('button',name='检查题库更新',exact=True).click()
                expect(page.get_by_text('当前在线题库直接使用已发布内容，无需下载。',exact=True)).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                assert not errors,errors
                browser.close()
                print(json.dumps({'admin_login':True,'long_reading':True,'draft_review_publish':True,'release_download':True,'original_copy':True,'student_update_entry':True,'mobile_no_overflow':True,'javascript_errors':errors},ensure_ascii=False))
        finally:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
            log.close()


if __name__=='__main__':main()
