"""七上诊断浏览器验收：临时数据库、禁用付费API、桌面及手机布局。"""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

import httpx
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
URL='http://127.0.0.1:8016'


def main():
    chrome=shutil.which('google-chrome-stable') or shutil.which('chromium')
    if not chrome:
        raise SystemExit('需要本机Chrome')
    with tempfile.TemporaryDirectory(prefix='ai-teacher-math-browser-') as temp:
        db_path=Path(temp)/'test.sqlite3'
        env={**os.environ,'DATABASE_PATH':str(db_path),'DEEPSEEK_API_KEY':''}
        process=subprocess.Popen([str(ROOT/'.venv/bin/uvicorn'),'app.main:app','--host','127.0.0.1','--port','8016','--no-access-log'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            with httpx.Client(trust_env=False) as client:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError(process.stderr.read().decode())
                    try:
                        if client.get(URL+'/api/v1/health').status_code==200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(.1)
                else:
                    raise RuntimeError('临时服务启动超时')
                errors=[]
                with sync_playwright() as p:
                    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
                    page=browser.new_page(viewport={'width':1440,'height':1050})
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    page.goto(URL)
                    page.get_by_role('button',name='数学诊断',exact=True).click()
                    expect(page.get_by_role('heading',name='找到下一步，从数学开始。')).to_be_visible()
                    expect(page.get_by_text('37 个标准题型',exact=True)).to_be_visible()
                    page.get_by_role('button',name='开始抽样诊断',exact=True).click()
                    expect(page.get_by_label('诊断答案',exact=True)).to_be_visible()
                    page.get_by_label('诊断答案',exact=True).fill('1/0')
                    page.get_by_role('button',name='提交诊断答案',exact=True).click()
                    expect(page.locator('.inline-error')).to_contain_text('分母不能为零')
                    expect(page.get_by_label('诊断答案',exact=True)).to_have_value('1/0')
                    history=client.get(URL+'/api/v1/math/diagnostics').json()['items']
                    session_id=history[0]['id']
                    for n in range(10):
                        session=client.get(URL+f'/api/v1/math/diagnostics/{session_id}').json()
                        current=session['current']
                        with sqlite3.connect(db_path) as db:
                            q=json.loads(db.execute('SELECT data FROM questions WHERE id=?',(current['question']['id'],)).fetchone()[0])
                        answer=q['common_errors'][0]['answer'] if n==0 and q['common_errors'] else q['answer']
                        page.get_by_label('诊断答案',exact=True).fill(answer)
                        page.get_by_role('button',name='提交诊断答案',exact=True).click()
                        if n==0:
                            expect(page.get_by_role('button',name='继续诊断',exact=True)).to_be_visible()
                            page.reload()
                            page.get_by_role('button',name='数学诊断',exact=True).click()
                            expect(page.get_by_label('诊断答案',exact=True)).to_be_visible()
                            assert client.get(URL+f'/api/v1/math/diagnostics/{session_id}').json()['answered']==1
                        elif n<9:
                            page.get_by_role('button',name='继续诊断',exact=True).click()
                    expect(page.get_by_role('heading',name='本次诊断已完成',exact=True)).to_be_visible()
                    expect(page.get_by_role('heading',name='接下来，练什么',exact=True)).to_be_visible()
                    expect(page.get_by_text('已答 10 题，答对 9 题',exact=True)).to_be_visible()
                    page.screenshot(path=ROOT/'docs/previews/preview-math-diagnostic-desktop.png',full_page=True,animations='disabled')
                    page.get_by_role('button',name='开始针对练习',exact=True).first.click()
                    expect(page.get_by_label('你的答案',exact=True)).to_be_visible()
                    page.set_viewport_size({'width':390,'height':844})
                    page.get_by_role('button',name='数学诊断',exact=True).click()
                    expect(page.get_by_role('heading',name='本次诊断已完成',exact=True)).to_be_visible()
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '手机页面横向溢出'
                    page.screenshot(path=ROOT/'docs/previews/preview-math-diagnostic-mobile.png',full_page=True,animations='disabled')
                    page.get_by_label('筛选数学题型').select_option('missing')
                    expect(page.get_by_text('科学记数法表示与还原',exact=True)).to_be_visible()
                    assert not errors,errors
                    browser.close()
            print('数学浏览器验收通过：入口、输入校验、刷新续做、10题完成、复习建议、针对练习、缺题筛选和390px布局。')
        finally:
            process.terminate();process.wait(timeout=10)


if __name__=='__main__':
    main()
