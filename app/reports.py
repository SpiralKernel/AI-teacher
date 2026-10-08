"""家长报告：可追溯数据图表、按证据版本缓存的 AI 分析与 PDF。"""
import asyncio
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import ai_policy, bank, bank_ai, observations
from app.course_catalog import BOOK_MAP
from app.db import connect, dumps, now
from app.identity import book_id, scope
from app.math_catalog import resolve_type
from app.question_types import template_type_id
from app.study import state

Period=Literal['week','month','all']


class Focus(BaseModel):
    type_id: str = Field(max_length=100)
    finding: str = Field(min_length=1,max_length=600)
    evidence_ids: list[str] = Field(min_length=1,max_length=8)


class Analysis(BaseModel):
    summary: str = Field(min_length=1,max_length=1200)
    strengths: list[str] = Field(default_factory=list,max_length=4)
    focus: list[Focus] = Field(default_factory=list,max_length=3)
    parent_actions: list[str] = Field(default_factory=list,max_length=4)
    next_steps: list[str] = Field(default_factory=list,max_length=4)
    uncertainty: str = Field(min_length=1,max_length=600)


def eligible_focus(evidence):
    if 'correct' in evidence:
        return evidence['correct'] is False
    return (evidence.get('kind') == 'difficulty' and
            evidence.get('policy_version') == ai_policy.VERSION and
            evidence.get('validation', {}).get('method') in {'independent_ai_review', 'reviewed_import'})


def validate_analysis(value, analysis):
    evidence={e['id']:e for e in value['evidence']}
    types={t['id'] for t in value['types']}
    for focus in analysis.focus:
        if focus.type_id not in types or any(
            eid not in evidence or evidence[eid].get('type_id') != focus.type_id or not eligible_focus(evidence[eid])
            for eid in focus.evidence_ids
        ):
            raise HTTPException(502,'分析引用的依据不足或不匹配，请重试；学习状态没有变化。')
    # There is no calibrated ability scale: reject numeric capability claims anywhere.
    text=dumps(analysis.model_dump())
    if re.search(r'\d(?:\.\d+)?\s*[%％]|百分之[零一二三四五六七八九十百\d]+|(?:能力|掌握)(?:评分|分数|得分)\s*[：:为是]?\s*\d', text):
        raise HTTPException(502,'分析包含未经校准的能力数值，请重试；学习状态没有变化。')


class Request(BaseModel):
    period: Period = 'week'


def snapshot(db, period):
    from app.math_learning import verified_pool
    value=state(db);book=BOOK_MAP[book_id()]
    start=(datetime.now(timezone.utc)-timedelta(days=7 if period=='week' else 30)).isoformat() if period!='all' else ''
    valid={q['id'] for pool in verified_pool(db).values() for q in pool} if book_id()=='math-7-1' else set()
    records=[];seen=set()
    if book_id()=='math-7-1':
        for row in db.execute("SELECT a.*,q.data,q.content_hash FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.student_id=current_student() AND a.status='submitted' ORDER BY a.submitted_at,a.id"):
            q,r=json.loads(row['data']),json.loads(row['result']);identity=row['content_hash']
            independent=q['id'] in valid and not row['hint_used'] and not r.get('assisted') and r.get('evidence_weight',0)>0 and identity not in seen
            seen.add(identity)
            if row['submitted_at']>=start:records.append({'id':'attempt:'+row['id'],'time':row['submitted_at'],'correct':bool(r['correct']),'assisted':bool(row['hint_used'] or r.get('assisted')),'independent':independent,'type_id':resolve_type(template_type_id(q)),'stem':q['stem'],'error':r.get('error')})
    where,args=bank.clauses(bank.Selection())
    for row in db.execute("SELECT a.*,q.data,q.content_hash FROM bank_attempts a JOIN bank_questions q ON q.id=a.question_id WHERE a.student_id=current_student() AND a.status='submitted' AND "+where+" ORDER BY a.submitted_at,a.id",args):
        q,r=json.loads(row['data']),json.loads(row['result']);identity=row['content_hash']
        independent=q.get('provenance',{}).get('teacher_reviewed') is True and not row['assisted'] and r.get('assessment_source')=='source_answer' and r.get('evidence_weight',0)>0 and identity not in seen
        seen.add(identity)
        from app.study import question_types
        types=question_types(db,q)
        independent=independent and bool(types) and all(t.get('classification_reviewed',True) for t in types)
        if row['submitted_at']>=start:records.append({'id':'bank:'+row['id'],'time':row['submitted_at'],'correct':bool(r['correct']),'assisted':bool(row['assisted']),'independent':independent,'type_id':types[0]['id'] if types else None,'stem':q['stem'],'error':None})
    notes=[n for n in observations.active(db) if n['created_at']>=start]
    chats=db.execute('SELECT COUNT(*) FROM teacher_messages m JOIN teacher_threads t ON t.id=m.thread_id WHERE t.student_id=current_student() AND t.book_id=? AND m.created_at>=?',(book_id(),start)).fetchone()[0]
    imported=db.execute("SELECT COUNT(*) FROM import_items i JOIN imports p ON p.id=i.import_id WHERE p.student_id=current_student() AND p.book_id=? AND p.status='confirmed' AND p.confirmed_at>=?",(book_id(),start)).fetchone()[0]
    chapters=[]
    for unit in book['units']:
        types=[t for t in value['types'] if t.get('unit_id')==unit['id']]
        chapters.append({'id':unit['id'],'name':unit['name'],'total':len(types),'stable':sum(t['status']=='表现稳定' for t in types),
                         'weak':sum(t['status']=='需要补强' for t in types),'learning':sum(t['status'] not in {'表现稳定','需要补强'} and bool(t['independent_count'] or t.get('observation_count')) for t in types),
                         'unknown':sum(not t['independent_count'] and not t.get('observation_count') for t in types)})
    daily={}
    for r in records:
        day=datetime.fromisoformat(r['time']).astimezone(ZoneInfo('Asia/Shanghai')).date().isoformat();item=daily.setdefault(day,{'day':day,'independent':0,'assisted':0,'other':0,'correct':0})
        item['independent' if r['independent'] else 'assisted' if r['assisted'] else 'other']+=1
        item['correct']+=int(r['independent'] and r['correct'])
    weak=[t for t in value['types'] if t['status']=='需要补强' or t.get('learning_status') in {'需要巩固','待确认'}]
    known=[t for t in value['types'] if t['independent_count'] or t.get('observation_count') or t.get('recorded')]
    next_steps=[f"围绕“{t['name']}”做几道新的独立练习，检查具体困难。" for t in weak[:3]] or ['继续当前章节的小量独立练习，逐步积累证据。']
    rule={'summary':f"本期保存 {len(records)} 次题库作答、{chats} 次AI提问和 {imported} 道已核对导入题。"+('目前独立证据仍较少，先关注学习过程，不下能力结论。' if sum(r['independent'] for r in records)<5 else '结合题型作答与对话线索安排后续练习。'),
          'strengths':[f"“{t['name']}”最近独立作答表现稳定。" for t in value['types'] if t['status']=='表现稳定'][:3],
          'focus':[],'parent_actions':['请孩子讲一讲解题理由，先听思路，再看答案。','区分独立完成与提示后完成，鼓励主动提问。'],'next_steps':next_steps,
          'uncertainty':'对话与导入题属于学习线索；独立题量少、未核验来源答案及未练习题型不能据此断言掌握。'}
    data={'period':period,'period_label':{'week':'最近7天','month':'最近30天','all':'累计记录'}[period],'book_id':book_id(),'student':{'nickname':(scope() or {}).get('nickname','学习者'),'grade':book['grade'],'term':book['term']},
          'summary':{'attempts':len(records),'independent':sum(r['independent'] for r in records),'assisted':sum(r['assisted'] for r in records),'questions':chats,'imported':imported,'observations':len(notes),'stable_types':sum(t['status']=='表现稳定' for t in value['types']),'covered_types':len(known)},
          'chapters':chapters,'trend':sorted(daily.values(),key=lambda r:r['day'])[-30:],'types':[{k:t.get(k) for k in ('id','name','unit_id','status','learning_status','independent_count','observation_count','learning_notes','reason')} for t in known],
          'evidence':records[-50:]+[{'id':'note:'+n['id'],'type_id':n['type_id'],'quote':n['evidence_quote'],'note':n['note'],'kind':n['kind'],'source':n['source'],
            'policy_version':n.get('policy_version'),'validation':n.get('validation',{})} for n in notes[-30:]],'rule_analysis':rule,
          'policy_version':ai_policy.VERSION}
    # 版本包含所有统计和可追溯材料；生成时间不进入指纹，重复打开不会重复消耗模型。
    data['fingerprint']=hashlib.sha256(dumps(data).encode()).hexdigest()
    cache=db.execute('SELECT * FROM parent_reports WHERE student_id=current_student() AND book_id=? AND period=?',(book_id(),period)).fetchone()
    data.update(analysis=json.loads(cache['data']) if cache and cache['fingerprint']==data['fingerprint'] else rule,
                analysis_source='ai' if cache and cache['fingerprint']==data['fingerprint'] else 'rules',
                generated_at=cache['created_at'] if cache and cache['fingerprint']==data['fingerprint'] else now())
    return data


def create_router(settings):
    router=APIRouter(prefix='/api/v1/reports',tags=['家长学情报告']);slots=asyncio.Semaphore(1)

    @router.get('')
    def report(period: Period='week'):
        with connect(settings.database_path) as db:return snapshot(db,period)

    @router.post('/analyze')
    async def analyze(body: Request):
        async with slots:
            with connect(settings.database_path) as db:value=snapshot(db,body.period)
            if value['analysis_source']=='ai':return value
            material={k:value[k] for k in ('student','period_label','summary','types','evidence')}
            material['focus_eligible_evidence_ids']=[e['id'] for e in value['evidence'] if eligible_focus(e)]
            result=await bank_ai.request_json(settings,ai_policy.messages(ai_policy.REPORT,material,content='请分析这一期学情。'),Analysis)
            validate_analysis(value,result)
            with connect(settings.database_path) as db:
                # 请求期间有新作答时，不把旧材料生成的分析标成最新版本。
                fresh=snapshot(db,body.period)
                if fresh['fingerprint']!=value['fingerprint']:return fresh
                db.execute('INSERT INTO parent_reports VALUES(current_student(),?,?,?,?,?) ON CONFLICT(student_id,book_id,period) DO UPDATE SET fingerprint=excluded.fingerprint,data=excluded.data,created_at=excluded.created_at',
                           (book_id(),body.period,value['fingerprint'],dumps(result.model_dump()),now()))
                return snapshot(db,body.period)

    @router.get('/pdf')
    def pdf(period: Period='week'):
        from app.report_pdf import render
        with connect(settings.database_path) as db:value=snapshot(db,period)
        return Response(render(value),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="AI-teacher-learning-report.pdf"','Cache-Control':'no-store'})

    return router
