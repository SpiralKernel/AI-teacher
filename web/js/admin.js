import { createAnnotationEditor } from './annotation-editor.js';
const root = document.querySelector('#admin-root'), notice = document.querySelector('#admin-notice');
const S = {student:null, page:'dashboard', catalog:null, dashboard:null, list:{items:[],total:0},
  filters:{family:'bank',subject:'',grade:'',term:'',status:'',reviewed:'all',difficulty:'',query:'',offset:0}, draft:null, preview:null, busy:false, dirty:false};
let noticeTimer;
function el(tag, attrs={}, ...children) {
  const n=document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(),v);
    else if (k==='class') n.className=v;
    else if (k in n && !k.startsWith('aria-')) n[k]=v;
    else n.setAttribute(k,v);
  }
  for (const child of children.flat(Infinity)) if (child!=null) n.append(child instanceof Node?child:document.createTextNode(String(child)));
  return n;
}
function message(text){notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,6500);}
async function api(path,body,method='POST') {
  const r=await fetch('/api/v1'+path,{credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{method,body:JSON.stringify(body)})});
  const value=await r.json();
  if(!r.ok) throw new Error(typeof value.detail==='string'?value.detail:'提交内容不完整，请检查输入。');
  return value;
}
async function action(fn){if(S.busy)return;S.busy=true;root.setAttribute('aria-busy','true');document.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=true);
  try{await fn();}catch(e){message(e.message);}finally{S.busy=false;root.setAttribute('aria-busy','false');document.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=false);}}
const btn=(text,fn,cls='')=>el('button',{type:'button',class:cls,onClick:()=>action(fn)},text);
const brand=()=>el('a',{class:'brand',href:'/'},el('b',{},'学'),'AI-teacher');
const date=(v)=>new Date(v).toLocaleString('zh-CN',{hour12:false});
const stateName={ready:'可练习',reference:'过程题',quarantine:'已隔离',superseded:'旧版本',verified:'规则核验',draft:'待审核',published:'已发布',withdrawn:'已撤下'};
const actionName={created:'建立草稿',saved:'保存草稿',published:'审核发布',withdrawn:'撤下题目'};
function select(label, options, value, change){const n=el('select',{'aria-label':label,onChange:e=>change(e.target.value)});
  for(const [id,text] of options)n.append(el('option',{value:String(id)},text));n.value=String(value??'');return n;}
function field(label,n){return el('label',{},label,n);}
function math(n){window.renderMathInElement?.(n,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,trust:false});}
async function load(){const session=await api('/auth/session');S.student=session.student;
  if(S.student?.is_admin){[S.catalog,S.dashboard]=await Promise.all([api('/admin/catalog'),api('/admin/dashboard')]);await loadList();}render();}
async function loadList(){const query=new URLSearchParams(Object.entries(S.filters).filter(([,v])=>v!==''));S.list=await api('/admin/questions?'+query);}
function canLeave(){return !S.dirty || confirm('当前修改还未保存，确定离开吗？');}
async function page(name){if(!canLeave())return;S.page=name;S.dirty=false;S.draft=null;S.preview=null;
  if(name==='dashboard'||name==='updates')S.dashboard=await api('/admin/dashboard');if(name==='questions')await loadList();render();}
function login(){
  if(S.student) return el('main',{class:'login panel'},brand(),el('h1',{},'需要维护权限'),el('p',{class:'subtle'},'当前账号可以正常学习，但尚未被授予题库维护权限。'),el('a',{href:'/'},'返回学习空间'),btn('切换账号',async()=>{await api('/auth/logout',{});S.student=null;render();}));
  const name=el('input',{autocomplete:'username',required:true,minLength:2,maxLength:40}),password=el('input',{type:'password',autocomplete:'current-password',required:true,minLength:8});
  return el('main',{class:'login panel'},brand(),el('p',{class:'eyebrow'},'CONTENT WORKSPACE'),el('h1',{},'让每道题，更准确。'),el('p',{class:'subtle'},'使用已获授权的账号登录题库工作台。'),
    el('form',{onSubmit:e=>{e.preventDefault();action(async()=>{await api('/auth/login',{username:name.value,password:password.value});password.value='';await load();});}},field('用户名',name),field('密码',password),el('button',{type:'submit',class:'primary'},'登录工作台')),
    el('a',{href:'/'},'返回学生端'));
}
function dashboard(){const d=S.dashboard,t=d.totals,subjects=d.subjects,max=Math.max(1,...subjects.map(s=>s.total));
  const metrics=[['学生账号',t.students,'每个学生独立保存学习记录'],['累计作答',t.attempts,'包含题库与原创核验练习'],['来源题目',t.bank_questions,'不包含已替换的历史版本'],['待审核草稿',t.drafts,`${t.reviewed} 道来源题已人工核对`]];
  return el('div',{},el('div',{class:'metrics'},metrics.map(([label,n,note],i)=>el('article',{class:'metric'+(i===3?' accent':'')},el('small',{},label),el('strong',{},n.toLocaleString()),el('small',{},note)))),
    d.annotations?el('p',{class:'notice'},`${d.annotations.candidates} 道完整标注候选 · ${d.annotations.rubric_pending} 道过程标准待完善 · ${d.annotations.excluded} 道无效题已剔除`):null,
    el('div',{class:'grid-two'},el('section',{class:'panel'},el('h2',{},'题库分布'),el('p',{class:'subtle'},'各科当前题量 · 仅计当前版本'),subjects.length?subjects.map(s=>el('div',{class:'bar-row'},el('span',{},S.catalog.subjects[s.subject]||s.subject),el('div',{class:'bar-track'},el('div',{class:'bar',style:`width:${100*s.total/max}%`})),el('span',{},s.total))):el('p',{class:'subtle'},'还没有导入来源题。'),el('small',{},`另有 ${t.original_questions} 道原创规则核验题。`)),
      el('section',{class:'panel'},el('h2',{},'最近 14 天练习'),d.trend.length?el('div',{class:'trend'},d.trend.map(v=>el('div',{class:'trend-col'},v.attempts,el('div',{class:'trend-bar',style:`height:${100*v.attempts/Math.max(1,...d.trend.map(a=>a.attempts))}px`}),v.day.slice(5)))):el('p',{class:'subtle'},'还没有已提交的练习。'),el('p',{class:'subtle'},`${t.ai_questions} 次 AI 提问 · ${t.imports} 份导入材料`),el('small',{},'这里汇总数量，不展示学生聊天、照片或具体作答。'))),
    el('section',{class:'panel',style:'margin-top:20px'},el('div',{class:'actions'},el('h2',{},'最近维护'),btn('进入题目标注',()=>page('questions'),'quiet')),d.changes.length?d.changes.map(c=>el('div',{class:'event'},el('span',{},`${actionName[c.action]||c.action} · 第 ${c.revision} 次修订`),el('small',{},`${c.username} / ${date(c.created_at)}`))):el('p',{class:'subtle'},'从一份草稿开始，修改都将留痕。')));
}
function filterBar(){const f=S.filters;const refresh=async(key,v)=>{if(!canLeave())return;f[key]=v;f.offset=0;if(key==='family')f.status='';S.draft=null;S.preview=null;S.dirty=false;await loadList();render();};
  const query=el('input',{type:'search',value:f.query,placeholder:'搜索题干、题型或题目编号','aria-label':'搜索题目'});
  return el('form',{class:'filters',onSubmit:e=>{e.preventDefault();action(()=>refresh('query',query.value));}},
    select('题目来源',[['bank','来源题库'],['draft','维护草稿'],['original','原创核验题']],f.family,v=>action(()=>refresh('family',v))),
    select('科目',[['','全部科目'],...Object.entries(S.catalog.subjects)],f.subject,v=>action(()=>refresh('subject',v))),
    select('年级',[['','全部年级'],[7,'七年级'],[8,'八年级'],[9,'九年级']],f.grade,v=>action(()=>refresh('grade',v))),
    select('学期',[['','全部学期'],[1,'上学期'],[2,'下学期']],f.term,v=>action(()=>refresh('term',v))),
    f.family==='original'?null:select('审核状态',f.family==='draft'?[['','全部草稿'],['draft','待审核'],['published','已发布'],['withdrawn','已撤下']]:[['','当前版本'],['ready','选择题'],['reference','过程题'],['quarantine','已隔离'],['superseded','历史版本']],f.status,v=>action(()=>refresh('status',v))),
    f.family==='bank'?select('人工核对',[['all','全部审核状态'],['pending','未人工核对'],['reviewed','已人工核对']],f.reviewed,v=>action(()=>refresh('reviewed',v))):null,
    select('难度',[['','全部难度'],[1,'基础'],[2,'进阶'],[3,'挑战']],f.difficulty,v=>action(()=>refresh('difficulty',v))),query,el('button',{type:'submit'},'搜索'));
}
async function openQuestion(q){if(!canLeave())return;S.dirty=false;
  if(S.filters.family==='original'){S.preview=await api('/admin/question?'+new URLSearchParams({family:'original',id:q.id}));S.draft=null;}
  else {S.draft=S.filters.family==='draft'?await api('/admin/drafts/'+q.id):await api('/admin/drafts',{family:'bank',question_id:q.id});S.preview=null;}
  render();document.querySelector('.editor')?.scrollIntoView({block:'start',behavior:'smooth'});
}
function questionList(){return el('div',{class:'list-pane'},el('div',{class:'question-list'},S.list.items.length?S.list.items.map(q=>el('article',{class:'question-card'+((S.draft?.id===q.id||S.draft?.published_id===q.id)?' active':'')},
  el('div',{class:'actions'},el('span',{class:'badge'+(q.reviewed?' blue':'')},stateName[q.state]||q.state),el('small',{},`${S.catalog.subjects[q.subject]||q.subject} · ${q.grade?`${q.grade}年级${q.term===1?'上册':q.term===2?'下册':' / 学期待核对'}`:'册次待核对'} · ${['','基础','进阶','挑战'][q.difficulty]}`)),
  el('p',{},q.stem.length>200?q.stem.slice(0,200)+'…':q.stem),el('p',{class:'answer'},'答案：'+(q.answer.length>100?q.answer.slice(0,100)+'…':q.answer)),
  q.annotation_exclusion?el('p',{class:'notice'},q.annotation_exclusion):q.annotation_issues?.length?el('small',{},`${q.annotation_issues.length} 项标注待核对`):null,
  el('div',{class:'actions'},btn(S.filters.family==='original'?'查看 / 复制':'编辑 / 标注',()=>openQuestion(q)),el('small',{},(q.type_tags||[]).slice(0,2).join(' · '))))) :el('div',{class:'empty'},'没有匹配的题目，试试更换筛选条件。')),
  el('div',{class:'pagination'},btn('上一页',async()=>{if(S.filters.offset===0)return;S.filters.offset=Math.max(0,S.filters.offset-20);await loadList();render();}),el('span',{},`共 ${S.list.total} 道 · 第 ${Math.floor(S.filters.offset/20)+1} 页`),btn('下一页',async()=>{if(S.filters.offset+20>=S.list.total)return;S.filters.offset+=20;await loadList();render();})));
}
function editor(){
  const back=()=>btn('← 返回题目列表',()=>{if(!canLeave())return;S.draft=null;S.preview=null;S.dirty=false;render();},'quiet back-to-list');
  if(S.preview){const q=S.preview;return el('section',{class:'panel editor'},back(),el('h2',{},'原创规则核验题'),el('div',{class:'preview'},q.stem),el('p',{},'答案：'+q.answer),el('ol',{},q.steps.map(v=>el('li',{},v))),el('p',{class:'subtle'},'这类题保留原始核验规则。需要修改时可复制为普通题，人工审核后发布。'),btn('复制为普通题草稿',async()=>{S.draft=await api('/admin/drafts',{family:'original',question_id:q.id});S.preview=null;render();},'coral'));}
  if(!S.draft)return el('section',{class:'empty'},el('h2',{},'为一道题，补齐依据。'),el('p',{},'从左侧选择题目，编辑题干、参考答案、解析与具体题型。'),el('small',{},'保存草稿不会改变学生正在使用的题目。'));
  const d=S.draft,f=d.form,inputs={};
  const annotationEditor=createAnnotationEditor(f,()=>S.dirty=true);
  const input=(key,rows=3)=>{const n=el('textarea',{rows,value:Array.isArray(f[key])?f[key].join('\n'):f[key]||'',onInput:()=>S.dirty=true});inputs[key]=n;return n;};
  const subject=select('编辑科目',Object.entries(S.catalog.subjects),f.subject,()=>{updateGoals();S.dirty=true;}),
    grade=select('编辑年级',[['','请选择年级'],[7,'七年级'],[8,'八年级'],[9,'九年级']],f.grade,()=>{updateGoals();S.dirty=true;}),
    term=select('编辑学期',[['','请选择学期'],[1,'上学期'],[2,'下学期']],f.term,()=>{updateGoals();S.dirty=true;});
  const goals=el('select',{multiple:true,size:6,'aria-label':'课程目标',onChange:()=>S.dirty=true});
  function updateGoals(){const selected=goals.options.length?[...goals.selectedOptions].map(o=>o.value):f.curriculum_goal_ids;
    goals.replaceChildren();const book=S.catalog.books.find(b=>b.id===`${subject.value}-${grade.value}-${term.value}`);
    if(book)for(const unit of book.units){const group=el('optgroup',{label:unit.name});for(const g of unit.goals)group.append(el('option',{value:g.id,selected:selected.includes(g.id)},g.name));goals.append(group);}}
  updateGoals();
  const kind=select('作答形式',[['reference','文字 / 过程题'],['single_choice','单项选择题'],['multiple_choice','多项选择题']],f.kind,()=>S.dirty=true);
  const options=el('textarea',{rows:4,value:f.options.map(o=>`${o.key}|${o.text}`).join('\n'),placeholder:'A|第一个选项\nB|第二个选项',onInput:()=>S.dirty=true});
  const difficulty=select('编辑难度',[[1,'基础'],[2,'进阶'],[3,'挑战']],f.difficulty,()=>S.dirty=true);
  const reviewed=el('input',{type:'checkbox'}),note=el('textarea',{rows:2,placeholder:'写明核对依据或修改原因，至少4字','aria-label':'审核说明'});
  function collect(){const next={...f,subject:subject.value,grade:Number(grade.value)||null,term:Number(term.value)||null,kind:kind.value,difficulty:Number(difficulty.value),
    curriculum_goal_ids:[...goals.selectedOptions].map(o=>o.value),options:options.value.trim()?options.value.split('\n').filter(v=>v.trim()).map(v=>{const i=v.indexOf('|');if(i<1)throw new Error('选项格式应为 A|选项内容，每行一个。');return {key:v.slice(0,i).trim().toUpperCase(),text:v.slice(i+1).trim()};}):[]};
    for(const [key,n] of Object.entries(inputs))next[key]=['steps','knowledge_tags','type_tags'].includes(key)?n.value.split('\n').map(v=>v.trim()).filter(Boolean):n.value;
    next.annotation=annotationEditor.collect(next);
    return next;
  }
  async function save(){const next=collect();S.draft=await api('/admin/drafts/'+d.id,{revision:S.draft.revision,form:next},'PUT');S.dirty=false;return S.draft;}
  const preview=el('div',{class:'preview',hidden:true});
  const stem=input('stem',8);stem.className='stem';
  const types=input('type_tags');
  const typePick=select('七上标准题型',[['','选用七上标准题型'],...S.catalog.math_types.map(t=>[t.name,t.name])],'',v=>{if(v){types.value=[...new Set([...types.value.split('\n').filter(Boolean),v])].join('\n');S.dirty=true;}});
  const node=el('section',{class:'panel editor'},back(),el('div',{class:'actions'},el('h2',{},'题目与标注'),el('span',{class:'badge'},stateName[d.state]),el('small',{},`修订 ${d.revision}`)),
    el('p',{class:'subtle'},'保存为草稿，人工核对后发布。已发布题目的历史作答不会被改写。'),
    d.has_missing_assets?el('p',{class:'notice'},'原题有缺失图片或材料。可保存标注草稿，当前不能发布。'):null,
    el('div',{class:'fields-three'},field('科目',subject),field('年级',grade),field('学期',term)),field('题干 / 阅读材料',stem),
    btn('预览公式与排版',()=>{preview.hidden=false;preview.textContent=collect().stem;math(preview);},'quiet'),preview,
    el('div',{class:'fields-two'},field('作答形式',kind),field('难度',difficulty)),field('选项（每行 A|内容；过程题留空）',options),field('参考答案',input('answer',3)),field('解析步骤（每行一步）',input('steps',5)),
    el('div',{class:'editor-section'},el('h3',{},'把题目放到正确的位置'),field('课程目标（可多选）',goals),field('知识点（每行一项）',input('knowledge_tags')),
      btn('填入选中目标的知识点名称',()=>{inputs.knowledge_tags.value=[...goals.selectedOptions].map(o=>o.textContent).join('\n');S.dirty=true;},'quiet'),
      field('具体题型（每行一项）',types),typePick,el('small',{},'例如“负数的绝对值”“一次函数图像上的点”；不要只标“选择题”。'),field('难度判断依据',input('difficulty_basis',2))),
    annotationEditor.node,
    el('details',{class:'editor-section source-note'},el('summary',{},'来源与历史'),el('p',{class:'code'},d.source_id||'手工新建'),el('p',{class:'subtle'},`来源：${d.provenance.dataset||'维护题库'}；许可：${d.provenance.license||'未注明，请核对来源使用范围'}`),
      ...(d.history||[]).map(e=>el('div',{class:'history'},`${actionName[e.action]||e.action} · 修订 ${e.revision} · ${date(e.created_at)}`))),
    el('div',{class:'editor-section'},el('h3',{},'人工审核'),field('审核说明',note),el('label',{class:'check'},reviewed,'我已核对题干、答案、解析、册次及题型标注。')),
    el('div',{class:'editor-toolbar actions'},btn('保存草稿',async()=>{await save();await loadList();render();message('草稿已保存，学生端题目尚未改变。');}),
      btn('审核并发布',async()=>{if(!reviewed.checked||note.value.trim().length<4)throw new Error('请填写审核说明并确认已核对。');await save();S.draft=await api(`/admin/drafts/${d.id}/publish`,{revision:S.draft.revision,reviewed:true,review_note:note.value.trim()});await loadList();render();message('已发布题目新版本；旧版本和作答保留。');},'coral'),
      d.published_id&&d.state!=='withdrawn'?btn('撤下已发布题目',async()=>{if(S.dirty)throw new Error('请先保存当前草稿，再撤下题目。');S.draft=await api(`/admin/drafts/${d.id}/withdraw`,{revision:S.draft.revision});await loadList();render();message('题目已退出新练习，历史记录保留；请发布更新包通知离线客户端。');},'quiet'):null));
  return node;
}
function questions(){return el('div',{},filterBar(),el('div',{class:'editor-layout'+(S.draft||S.preview?' has-editor':'')},questionList(),editor()));}
async function download(path,name){const r=await fetch('/api/v1'+path,{credentials:'same-origin'});if(!r.ok)throw new Error('下载失败，请先发布更新包。');const url=URL.createObjectURL(await r.blob());const a=el('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function updates(){const r=S.dashboard.release;
  return el('div',{},el('section',{class:'panel'},el('p',{class:'eyebrow'},'CONTENT DELIVERY'),el('h2',{},'让题库更新，独立于应用升级。'),el('p',{class:'subtle'},'审核后的来源题和原创核验题组成一个冻结版本。未来安卓端可联网下载，并保留本机学习记录。'),
    el('div',{class:'status-line'},el('span',{class:'badge blue'},r?`版本 ${r.version}`:'尚未发布'),r?el('small',{},`${r.item_count} 道题 · ${date(r.created_at)}`):null),
    el('p',{class:'notice'},'未审核的来源题、草稿、缺图材料和撤下题目不会进入新更新包。更新包仅含题库内容，不含账号、聊天、照片或学情记录。'),
    el('div',{class:'actions',style:'margin-top:20px'},btn('发布题库更新包',async()=>{const result=await api('/content/publish',{});S.dashboard=await api('/admin/dashboard');render();message(`题库版本 ${result.version} 已就绪，共 ${result.item_count} 道题。`);},'coral'),r?btn('下载更新包',()=>download('/content/feed/package?version='+r.version,`ai-teacher-content-v${r.version}.json`)):null,
      r?btn('下载版本清单',async()=>{const value=await api('/content/feed/manifest');const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));el('a',{href:url,download:'ai-teacher-content-manifest.json'}).click();setTimeout(()=>URL.revokeObjectURL(url),1000);}):null)),
    el('section',{class:'panel',style:'margin-top:20px'},el('h2',{},'在线与离线的使用方式'),el('p',{},'在线网页直接使用已发布题目。离线客户端连接配置好的题库源，先检查版本，再下载、校验并整体安装；中断或校验失败时保留原题库。'),el('p',{class:'subtle'},'题库源和只读更新凭证由服务端配置，不在学生页面填写。安卓打包尚未完成，本版已提供更新协议、联网安装接口与文件导入工具。')));
}
function render(){root.replaceChildren();if(!S.student?.is_admin){root.append(login());return;}
  const titles={dashboard:['数据概览','看见学习，也照顾题目的质量。'],questions:['题目标注','把答案、依据与题型，一起整理清楚。'],updates:['题库更新','审核一次，让各端保持一致。']};
  root.append(el('div',{class:'layout'},el('aside',{class:'sidebar'},brand(),el('small',{},'题库工作台'),el('nav',{},Object.entries(titles).map(([key,[label]])=>btn(label,()=>page(key),S.page===key?'active':''))),
    el('footer',{},el('small',{},S.student.username),el('a',{href:'/'},'返回学生端'),btn('退出账号',async()=>{await api('/auth/logout',{});S.student=null;render();},'quiet'))),
    el('main',{class:'workspace'},el('header',{class:'page-head'},el('div',{},el('p',{class:'eyebrow'},'AI-TEACHER / WORKSPACE'),el('h1',{},titles[S.page][0]),el('p',{class:'subtle'},titles[S.page][1])),
      S.page==='questions'?btn('＋ 新建题目',async()=>{if(!canLeave())return;S.draft=await api('/admin/drafts',{});S.preview=null;S.dirty=false;render();},'primary'):btn('刷新数据',async()=>{S.dashboard=await api('/admin/dashboard');render();},'quiet')),
      S.page==='questions'?questions():S.page==='updates'?updates():dashboard())));
}
window.addEventListener('beforeunload',e=>{if(S.dirty){e.preventDefault();e.returnValue='';}});
load().catch(e=>{message(e.message);root.replaceChildren(el('p',{class:'loading'},'工作台暂不可用，请刷新页面重试。'));});
