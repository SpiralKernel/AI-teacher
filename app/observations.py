"""对话/试卷学习线索：自动写入状态，保留引用、来源与可撤销记录。"""
import hashlib
import json
import uuid
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import BaseModel, Field
from typing import Literal

from app.course_catalog import BOOK_MAP, GOALS
from app.db import dumps, now
from app.identity import book_id
from app.math_catalog import TYPE_MAP, resolve_type
from app.question_types import COARSE_NAMES, normalize_name, register_ai_type


class Observation(BaseModel):
    type_id: str = Field(default='', max_length=100)
    type_name: str = Field(min_length=1, max_length=80)
    definition: str = Field(default='', max_length=500)
    goal_id: str = Field(default='', max_length=100)
    kind: Literal['question_interest','self_report','difficulty','guided_success','understanding_check','reviewed_success']
    evidence_quote: str = Field(min_length=1, max_length=500)
    note: str = Field(min_length=1, max_length=500)
    evidence_source: Literal['message', 'student_draft', 'image_answer'] = 'message'
    check_message_id: str = Field(default='', max_length=60)


def register_type(db, type_id, name, definition='', knowledge_ids=(), source_id='teacher'):
    bid=book_id();book=BOOK_MAP[bid]
    if bid=='math-7-1':
        canonical=resolve_type(type_id,name)
        if canonical:
            return canonical
    row=db.execute("SELECT id FROM question_types WHERE subject='math' AND grade=? AND term=? AND (id=? OR normalized_name=?)",(book['grade'],book['term'],type_id,normalize_name(name))).fetchone()
    if row:
        return row[0]
    # 显式指向其他阶段的类型不自动改名归入当前册次。
    if type_id and (type_id.startswith('m7a:') or db.execute('SELECT 1 FROM question_types WHERE id=?',(type_id,)).fetchone()):
        return None
    if not name.strip() or normalize_name(name) in COARSE_NAMES:
        return None
    if bid=='math-7-1':
        value=SimpleNamespace(question_type_id=type_id,question_type_name=name,question_type_description=definition,knowledge_ids=list(knowledge_ids))
        return register_ai_type(db,value,source_id)
    normalized=normalize_name(name)
    tid='ai:'+hashlib.sha256((bid+':'+normalized).encode()).hexdigest()[:20]
    data={'id':tid,'name':name,'description':definition,'subject':'math','grade':book['grade'],'term':book['term'],'knowledge_ids':[], 'source':'ai','needs_review':True}
    db.execute("INSERT OR IGNORE INTO question_types VALUES(?,'math',?,?,?,?)",(tid,book['grade'],book['term'],normalized,dumps(data)))
    return tid


def save(db, proposals, message_id, student_text, source='conversation', validation=None):
    from app.ai_policy import VERSION
    if source == 'conversation' and validation is None:
        return []
    saved=[];seen=set()
    for proposal in proposals:
        # 模型不得凭空制造学生说过的话，也不能把“问了问题”直接记成不会。
        if proposal.evidence_quote not in student_text:
            continue
        canonical=resolve_type(proposal.type_id,proposal.type_name) if book_id()=='math-7-1' else None
        if proposal.goal_id and (proposal.goal_id not in GOALS or GOALS[proposal.goal_id]['book_id']!=book_id()):
            continue
        if not canonical and not proposal.goal_id and not db.execute('SELECT 1 FROM question_types WHERE id=?',(proposal.type_id,)).fetchone():
            continue
        tid=register_type(db,proposal.type_id,proposal.type_name,proposal.definition,source_id=message_id or source)
        if not tid or (tid,proposal.kind) in seen:
            continue
        seen.add((tid,proposal.kind))
        goal=proposal.goal_id if proposal.goal_id in GOALS and GOALS[proposal.goal_id]['book_id']==book_id() else None
        canonical=TYPE_MAP.get(tid)
        if canonical:goal=canonical['goal_id']
        data={**proposal.model_dump(),'type_id':tid,'type_name':canonical['name'] if canonical else proposal.type_name,
              'goal_id':goal,'source':source,'confidence':'low' if proposal.kind in {'question_interest','self_report'} else 'medium',
              'confidence_basis':'policy_category_not_calibrated_probability',
              'independent':False,'mastery_weight':0,
              'policy_version':VERSION, 'validation':validation or {'method':'reviewed_import'}}
        oid=str(uuid.uuid4())
        db.execute('INSERT INTO learning_observations VALUES(?,current_student(),?,?,?,?,0,?)',(oid,book_id(),tid,message_id,dumps(data),now()))
        saved.append({'id':oid,**data})
    return saved


def active(db):
    return [{'id':r['id'],**json.loads(r['data']),'created_at':r['created_at']} for r in db.execute('SELECT * FROM learning_observations WHERE student_id=current_student() AND book_id=? AND dismissed=0 ORDER BY created_at,id',(book_id(),))]


def augment(db, groups):
    items=active(db)
    for note in items:
        tid=note['type_id']
        group=groups.setdefault(tid,{'id':tid,'name':note['type_name'],'unit_id':GOALS[note['goal_id']]['unit_id'] if note.get('goal_id') in GOALS else None,
                                    'can_do':note.get('definition',''),'evidence':[],'recorded':0})
        group.setdefault('learning_notes',[]).append(note)
    for group in groups.values():
        all_notes=group.get('learning_notes',[])
        notes=all_notes[-5:]
        label='正在了解'
        if notes:
            substantive=[n for n in all_notes if n['kind']!='question_interest']
            kind=(substantive or notes)[-1]['kind']
            label={'difficulty':'需要巩固','self_report':'待确认','question_interest':'正在了解','guided_success':'正在理解','understanding_check':'待独立验证','reviewed_success':'待独立验证'}[kind]
        group.update(learning_notes=notes,observation_count=sum(n['type_id']==group['id'] for n in items),learning_status=label if notes else None)
    return groups


def dismiss(db, observation_id):
    row=db.execute('SELECT id FROM learning_observations WHERE id=? AND student_id=current_student() AND book_id=?',(observation_id,book_id())).fetchone()
    if not row:raise HTTPException(404,'学习线索不存在')
    db.execute('UPDATE learning_observations SET dismissed=1 WHERE id=?',(observation_id,))
