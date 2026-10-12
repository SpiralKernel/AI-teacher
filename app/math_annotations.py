"""Validate a hash-pinned Luna batch before atomically creating question snapshots."""
import copy
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Literal

from pydantic import Field

from app import bank
from app.db import audit
from app.question_annotation import Annotation, StrictModel, source_fingerprint, validate_for_question


class Entry(StrictModel):
    question_id: str = Field(min_length=1, max_length=200)
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    decision: Literal['annotate', 'exclude']
    reason: str = Field(min_length=1, max_length=3000)
    annotation: Annotation | None


def load_entries(paths):
    entries = []; seen = set()
    for path in paths:
        with Path(path).open() as stream:
            for line_no, line in enumerate(stream, 1):
                if not line.strip():continue
                try:
                    e = Entry.model_validate_json(line)
                    if e.question_id in seen:raise ValueError('题号重复')
                    if (e.decision == 'annotate') != (e.annotation is not None):raise ValueError('处理决定和标注不一致')
                    if e.annotation and (e.annotation.review.status != 'candidate' or e.annotation.review.method == 'teacher'):
                        raise ValueError('Luna 批量结果只能为待审核候选')
                    seen.add(e.question_id);entries.append(e)
                except ValueError as exc:
                    raise ValueError(f'{Path(path).name}:{line_no}: {exc}') from exc
    return entries


def apply_batch(db, entries, *, dry_run=True):
    """Whole batch succeeds or rolls back. Existing answers/student records are immutable."""
    counts = Counter(total=len(entries)); plans = defaultdict(list)
    # A write lock closes the gap between fingerprint validation and snapshot creation.
    if not dry_run:db.execute('BEGIN IMMEDIATE')
    try:
        current = {}
        for row in db.execute("SELECT source_id,data FROM bank_questions WHERE subject='math' AND stage='junior' AND status!='superseded'"):
            q = json.loads(row['data'])
            current[q.get('annotation_source_question_id', q['id'])] = (row['source_id'], q)
        for e in entries:
            if e.question_id not in current:raise ValueError(f'来源题不存在或已被其它修订替换：{e.question_id}')
            dataset, q = current[e.question_id]
            pinned = {**q, 'id':e.question_id}
            if source_fingerprint(pinned) != e.source_sha256:raise ValueError(f'来源内容已变化，拒绝贴标：{e.question_id}')
            if q.get('provenance',{}).get('teacher_reviewed'):
                raise ValueError(f'人工审核内容不能被候选批次覆盖：{e.question_id}')
            value = e.annotation.model_dump() if e.annotation else None
            if q.get('annotation_source_sha256') == e.source_sha256 and q.get('annotation') == value and q.get('annotation_exclusion') == (e.reason if e.decision=='exclude' else None):
                counts['unchanged'] += 1;continue
            if value:
                a = validate_for_question(value, q)
                if q['status']=='quarantine' or q.get('has_missing_assets') or q.get('quality',{}).get('answer_check',{}).get('status')=='failed':
                    raise ValueError(f'无效题必须剔除，不能靠新标注放开：{e.question_id}')
                if a.review.answer_status == 'checked':raise ValueError('批量候选不可擅自认证来源答案')
                counts['annotated'] += 1
                counts[a.review.method] += 1
                counts['parts_pending'] += int('part_answer_pending' in a.review.issues)
                counts['rubric_pending'] += int('rubric_pending' in a.review.issues)
                counts['fine_type_pending'] += int('fine_type_pending' in a.review.issues)
                counts['score_pending'] += int(a.grading.full_score is None)
            else:counts['excluded'] += 1
            new = copy.deepcopy(q)
            new.update(annotation=value, annotation_source_question_id=e.question_id,
                       annotation_source_sha256=e.source_sha256, annotation_exclusion=e.reason if e.decision=='exclude' else None)
            if value:
                old = new.get('fine_type_annotations', [])
                existing = {t['label'] for t in old}
                new['fine_type_annotations'] = old + [dict(label=t, origin='luna', basis='structured_candidate', needs_review=True)
                                                      for t in a.fine_types if t not in existing]
            else:
                new.update(status='quarantine', can_practice=False, evidence_invalidated=True)
                new['issues'] = list(dict.fromkeys([*new.get('issues',[]), 'annotation_excluded']))
            # An annotation revision uses the existing immutable quality upgrade path.
            new['quality'] = {**new.get('quality',{}), 'annotation_schema_version':1}
            plans[dataset].append(new)
        if not dry_run:
            for dataset, records in plans.items():
                manifest = json.loads(db.execute('SELECT manifest FROM bank_sources WHERE id=?',(dataset,)).fetchone()[0])
                bank.import_records(db, dataset, records, manifest, transaction=False)
                from app.admin import supersede
                for q in records:
                    if q.get('annotation_exclusion'):
                        supersede(db,q['id'],invalidate=True)
            audit(db, 'math_annotation_batch', dict(counts))
        return dict(counts)
    except BaseException:
        if not dry_run:db.rollback()
        raise
