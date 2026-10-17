/* Complete annotation editing lives separately from the admin list/workflow. */
const formats = {single_choice:'单项选择',multiple_choice:'多项选择',fill_blank:'填空',calculation:'计算',proof:'证明',application:'应用',composite:'综合解答',short_answer:'简答'};
export function createAnnotationEditor(form, dirty) {
  const el=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){
    if(k==='onInput')n.addEventListener('input',v);else if(k in n)n[k]=v;else n.setAttribute(k,v);}
    for(const c of children.flat(Infinity))if(c!=null)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n;};
  const field=(name,n)=>{n.setAttribute('aria-label',name);return el('label',{},name,n);};
  const text=(value='',rows=2)=>el('textarea',{value,rows,onInput:dirty});
  const lines=(value=[])=>text(value.join('\n'));
  const values=n=>n.value.split('\n').map(v=>v.trim()).filter(Boolean);
  const number=v=>el('input',{type:'number',min:0.01,max:1000,step:'any',value:v??'',onInput:dirty});
  const select=(choices,value)=>el('select',{value,onInput:dirty},Object.entries(choices).map(([key,label])=>el('option',{value:key,selected:key===value},label)));
  const enabled=el('input',{type:'checkbox',checked:!!form.annotation,onInput:()=>{body.hidden=!enabled.checked;dirty();}});
  const a=structuredClone(form.annotation || {schema_version:1,response_format:form.kind==='reference'?'short_answer':form.kind,
    knowledge:{primary:form.knowledge_tags||[],supporting:[],prerequisites:[]},fine_types:form.type_tags||[],
    difficulty:{level:form.difficulty,basis:form.difficulty_basis||'待填写难度依据',origin:'teacher',calibrated:false},
    curriculum:{grade:form.grade,term:form.term,book_id:form.curriculum_book_id||null,goal_ids:form.curriculum_goal_ids||[],scope_status:'unknown',basis:'维护者核对'},
    answer_spec:{mode:form.kind==='reference'?'text':'choice',accepted_answers:[],equivalence:form.kind==='reference'?'manual':'exact',constraints:[],unit:null,tolerance:null},
    parts:[],grading:{mode:form.kind==='reference'?'ai_rubric':'objective',full_score:null,allow_alternative_methods:true,uncertainty_policy:'review_required'},
    review:{status:'candidate',answer_status:'source_only',issues:[],method:'teacher',notes:''},origin:{model:'teacher',batch_id:''}});
  const format=select(formats,a.response_format),primary=lines(a.knowledge.primary),supporting=lines(a.knowledge.supporting),pre=lines(a.knowledge.prerequisites),fine=lines(a.fine_types);
  const mode=select({choice:'选项',numeric:'数值',expression:'表达式',text:'文字',multipart:'多问',proof:'证明'},a.answer_spec.mode);
  const equivalence=select({exact:'精确匹配',numeric:'数值等价',symbolic:'表达式等价',semantic:'语义等价',rubric:'按过程标准',manual:'需人工判断'},a.answer_spec.equivalence);
  const accepted=lines(a.answer_spec.accepted_answers),constraints=lines(a.answer_spec.constraints),unit=text(a.answer_spec.unit||'',1),tolerance=number(a.answer_spec.tolerance);
  tolerance.min='0';
  const fullScore=number(a.grading.full_score),gradeMode=select({objective:'客观判定',ai_rubric:'AI 辅助过程评阅',manual:'人工复核'},a.grading.mode);
  const alternatives=el('input',{type:'checkbox',checked:a.grading.allow_alternative_methods,onInput:dirty});
  const verified=el('input',{type:'checkbox',checked:a.review.status==='reviewed',onInput:dirty});
  const answerStatus=select({source_only:'仅沿用来源答案',checked:'已独立核验答案',conflict:'发现答案冲突',unknown:'答案待确认'},a.review.answer_status);
  const issues=lines(a.review.issues),notes=text(a.review.notes);
  const rows=[],container=el('div',{class:'annotation-parts'});
  function addPart(p={id:`p${rows.length+1}`,prompt:'',reference_answer:null,solution_steps:[],knowledge_tags:[],type_tags:[],depends_on:[],points:null,rubric:[],common_errors:[]}) {
    const prompt=text(p.prompt,3),answer=text(p.reference_answer||'',3),steps=lines(p.solution_steps),knowledge=lines(p.knowledge_tags),types=lines(p.type_tags),dependencies=lines(p.depends_on),points=number(p.points),criteria=[],criteriaBox=el('div');
    const id=el('input',{value:p.id,onInput:dirty}),errors=lines(p.common_errors.map(e=>e.description));
    function criterion(c={id:`c${criteria.length+1}`,description:'',points:null,evidence_required:''}) {
      const cid=el('input',{value:c.id,onInput:dirty}),description=text(c.description),score=number(c.points),evidence=text(c.evidence_required);
      const item=el('div',{class:'annotation-criterion'},field('得分点编号',cid),field('判定依据',description),field('分值（原题未注明则留空）',score),field('应在学生解答中看到的依据',evidence));
      const row={item,collect:()=>({id:cid.value.trim(),description:description.value,points:score.value===''?null:Number(score.value),evidence_required:evidence.value})};
      const remove=el('button',{type:'button'},'删除得分点');remove.addEventListener('click',()=>{criteria.splice(criteria.indexOf(row),1);item.remove();dirty();});item.append(remove);criteria.push(row);criteriaBox.append(item);
    }
    p.rubric.forEach(criterion);
    const add=el('button',{type:'button'},'＋ 添加得分点');add.addEventListener('click',()=>{criterion();dirty();});
    const item=el('details',{open:rows.length===0},el('summary',{},`小问 ${p.id}`),field('小问编号',id),field('本问题干',prompt),field('本问参考答案',answer),field('本问解析（每行一步）',steps),
      field('本问知识点（每行一项）',knowledge),field('本问具体题型（每行一项）',types),field('依赖的前面小问编号（每行一项）',dependencies),field('本问分值（未知留空）',points),criteriaBox,add,field('常见错误（每行一项）',errors));
    const row={item,collect:()=>({...p,id:id.value.trim(),prompt:prompt.value,reference_answer:answer.value||null,solution_steps:values(steps),knowledge_tags:values(knowledge),type_tags:values(types),depends_on:values(dependencies),points:points.value===''?null:Number(points.value),rubric:criteria.map(c=>c.collect()),
      common_errors:values(errors).map(description=>p.common_errors.find(e=>e.description===description)||{description,knowledge_tags:values(knowledge),type_tags:values(types)})})};
    const remove=el('button',{type:'button'},'删除本问');remove.addEventListener('click',()=>{rows.splice(rows.indexOf(row),1);item.remove();dirty();});item.append(remove);rows.push(row);container.append(item);
  }
  a.parts.forEach(addPart);
  const add=el('button',{type:'button'},'＋ 添加小问');add.addEventListener('click',()=>{addPart();dirty();});
  const body=el('div',{hidden:!enabled.checked},field('完整作答形式',format),field('主要知识点',primary),field('辅助知识点',supporting),field('前置知识',pre),field('细分题型',fine),
    el('div',{class:'fields-two'},field('答案形式',mode),field('答案等价规则',equivalence)),field('可接受答案（每行一项）',accepted),field('定义域 / 单位 / 精度等要求',constraints),
    el('div',{class:'fields-two'},field('答案单位（可留空）',unit),field('数值容差（未知留空）',tolerance)),container,add,
    el('div',{class:'fields-two'},field('评阅方式',gradeMode),field('整题满分（未知留空）',fullScore)),el('label',{class:'check'},alternatives,'允许数学上正确的其他解法'),
    field('答案核验状态',answerStatus),field('待审问题（处理完相应问题后删除对应项）',issues),field('标注审核说明',notes),el('label',{class:'check'},verified,'我已核对小问、答案规则、得分点和待审问题。'));
  return {node:el('section',{class:'editor-section annotation-editor'},el('h3',{},'完整标注与大题判分'),el('p',{class:'subtle'},'分值未知请留空；候选标准供评阅参考，不能自动认证学生掌握。'),el('label',{class:'check'},enabled,'启用完整标注'),body),
    collect(meta){if(!enabled.checked)return null;return {...a,response_format:format.value,knowledge:{primary:values(primary),supporting:values(supporting),prerequisites:values(pre)},fine_types:values(fine),
      difficulty:{...a.difficulty,level:meta.difficulty,basis:meta.difficulty_basis||'待填写难度依据'},curriculum:{...a.curriculum,grade:meta.grade,term:meta.term,book_id:meta.curriculum_book_id||null,goal_ids:meta.curriculum_goal_ids,scope_status:verified.checked?'reviewed':a.curriculum.scope_status},
      answer_spec:{...a.answer_spec,mode:mode.value,equivalence:equivalence.value,accepted_answers:values(accepted),constraints:values(constraints),unit:unit.value||null,tolerance:tolerance.value===''?null:Number(tolerance.value)},parts:rows.map(r=>r.collect()),
      grading:{...a.grading,mode:gradeMode.value,full_score:fullScore.value===''?null:Number(fullScore.value),allow_alternative_methods:alternatives.checked},review:{...a.review,status:verified.checked?'reviewed':'candidate',method:verified.checked?'teacher':a.review.method,answer_status:answerStatus.value,issues:values(issues),notes:notes.value}};}};
}
