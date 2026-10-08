"use strict";
const mathState = {data: null, sessions: [], session: null, unit: "", filter: "all", busy: false, answer: "", error: "", feedback: null};

async function loadMath() {
  const history = await api("/math/diagnostics");
  mathState.sessions = history.items;
  const id = mathState.session?.id || history.items.find((s) => s.status === "active")?.id;
  if (id) {
    mathState.session = await api("/math/diagnostics/" + id);
    if (mathState.session.status === "active") mathState.unit = mathState.session.unit_id || "";
  }
  mathState.data = await api("/math/coverage" + (mathState.unit ? "?unit_id=" + encodeURIComponent(mathState.unit) : ""));
}
async function openMath() {
  try { await loadMath(); setView("math"); } catch (error) { toast(error.message); }
}
function mathButton(text, action, light = false, disabled = false) {
  return el("button", {type: "button", class: "btn" + (light ? " light" : ""), disabled: state.busy || mathState.busy || disabled, onClick: action}, text);
}
async function mathStart() {
  if (mathState.busy) return;
  mathState.busy = true; mathState.error = ""; render();
  try {
    mathState.session = await api("/math/diagnostics", {size: 10, unit_id: mathState.unit || null});
    mathState.feedback = null; mathState.answer = "";
    await loadMath();
  } catch (error) { mathState.error = error.message; }
  finally { mathState.busy = false; render(); }
}
async function mathSubmit(event) {
  event.preventDefault();
  const session = mathState.session;
  if (mathState.busy || !session?.current || !mathState.answer.trim()) return;
  mathState.busy = true; mathState.error = ""; render();
  const position = session.current.position;
  try {
    mathState.session = await api(`/math/diagnostics/${session.id}/answer`, {position, answer: mathState.answer.trim()});
    mathState.feedback = mathState.session.items.find((i) => i.position === position);
    mathState.answer = "";
    await Promise.all([loadMath(), refreshStudent()]);
  } catch (error) { mathState.error = error.message; }
  finally { mathState.busy = false; render(); }
}
async function mathCancel() {
  if (mathState.busy) return;
  mathState.busy = true; render();
  try {
    mathState.session = await api(`/math/diagnostics/${mathState.session.id}/cancel`, {});
    mathState.feedback = null; mathState.answer = "";
    await loadMath();
  } catch (error) { mathState.error = error.message; }
  finally { mathState.busy = false; render(); }
}
async function mathPractice(typeId) {
  if (state.busy || mathState.busy) return;
  state.busy = true; render();
  try {
    state.attempt = await api("/math/practice", {type_id: typeId});
    state.result = null; state.hint = null; state.messages = []; state.draft = "";
    state.view = "practice";
  } catch (error) { toast(error.message); }
  finally { state.busy = false; render(); }
}
function mathEvidence(t) {
  return el("details", {class: "math-evidence"}, el("summary", {}, `查看 ${t.attempts} 道有效作答的依据`),
    t.evidence.length ? t.evidence.map((e) => el("article", {class: "math-evidence-item"},
      el("strong", {}, e.correct ? "正确" : "需要检查"),
      el("p", {}, e.stem),
      el("p", {class: "note"}, `你的答案：${e.answer} · ${e.assisted ? "使用过辅助" : "独立作答"} · ${new Date(e.submitted_at).toLocaleString("zh-CN")}`),
      e.error ? el("p", {}, e.error.feedback) : null)) : el("p", {class: "note"}, "尚无有效作答，不能据此判断不会。"));
}
function mathRecommendations(session) {
  return el("section", {class: "panel"}, el("h2", {}, "接下来，练什么"),
    el("p", {class: "note"}, "根据已测题型与前置关系安排；未测到的题型还需要后续诊断。"),
    session.recommendations.length ? session.recommendations.map((r) => el("article", {class: "math-plan"},
      el("div", {}, el("h3", {}, r.name), el("p", {}, r.reason)),
      mathButton(r.available ? "开始针对练习" : "该题型待补题", () => mathPractice(r.type_id), true, !r.available)))
      : el("p", {}, session.answered ? "当前已测题型的表现较稳，可以通过其他题型和间隔复测继续检查。" : "完成作答后，这里会给出下一步建议。"));
}
function mathSessionView() {
  const s = mathState.session;
  if (!s) return null;
  const feedback = mathState.feedback;
  const current = s.current;
  const input = el("input", {id: "diagnostic-answer", "aria-label": "诊断答案", inputmode: "decimal", autocomplete: "off", value: mathState.answer,
    disabled: mathState.busy, onInput: (e) => {mathState.answer = e.target.value;}});
  return el("div", {class: "math-session"},
    el("section", {class: "panel"},
      el("div", {class: "section-title"}, el("h2", {}, s.status === "active" ? "七上数学 · 抽样诊断" : s.status === "completed" ? "本次诊断已完成" : "本次诊断已结束"),
        el("span", {class: "tag"}, `${s.answered} / ${s.total} 题`)),
      el("progress", {class: "math-progress", max: s.total, value: s.answered, "aria-label": "诊断进度"}),
      el("p", {class: "note"}, s.note),
      feedback && s.status === "active" ? el("div", {class: "math-feedback"},
        el("h3", {}, feedback.result.correct ? "这一步答对了" : "先检查这一步"),
        el("p", {}, `你的答案：${feedback.answer}　参考答案：${feedback.result.answer}`),
        feedback.result.error ? el("p", {}, feedback.result.error.feedback) : null,
        el("ol", {}, feedback.result.steps.map((line) => el("li", {}, line))),
        mathButton("继续诊断", () => {mathState.feedback = null; render();}))
      : current ? el("form", {onSubmit: mathSubmit, class: "math-diagnostic-form"},
        el("span", {class: "tag"}, `第 ${current.position + 1} 题 · ${current.type_name}`),
        el("h3", {class: "math-question"}, current.question.stem),
        el("label", {for: "diagnostic-answer"}, "你的答案（数值，可填分数）"), input,
        el("button", {type: "submit", class: "btn", disabled: mathState.busy}, mathState.busy ? "正在保存…" : "提交诊断答案"))
      : el("div", {class: "math-result-summary"},
        el("strong", {}, `已答 ${s.answered} 题，答对 ${s.summary.correct} 题`),
        el("p", {}, `本次测到 ${s.summary.measured_types} 个题型，还有 ${s.summary.unmeasured_types} 个范围内题型未抽测。`),
        s.items.filter((i) => i.result).map((i) => el("details", {class: "math-evidence"},
          el("summary", {}, `${i.result.correct ? "✓" : "↺"} ${i.type_name}`), el("p", {}, i.stem),
          el("p", {}, `你的答案：${i.answer}　参考答案：${i.result.answer}`),
          el("ol", {}, i.result.steps.map((line) => el("li", {}, line)))))),
      s.status === "active" ? el("div", {class: "actions"},
        mathButton("暂时离开，稍后继续", () => setView("learn"), true),
        mathButton("结束本次诊断", mathCancel, true)) : null),
    s.status !== "active" ? mathRecommendations(s) : null);
}
function mathView() {
  const data = mathState.data;
  if (!data) return el("div", {class: "empty"}, "正在加载数学题型…");
  const unitSelect = el("select", {"aria-label": "数学诊断单元", disabled: mathState.busy || mathState.session?.status === "active",
    onChange: async (e) => {mathState.unit = e.target.value; mathState.session = null; mathState.feedback = null; mathState.error = "";
      try {await loadMath(); render();} catch (error) {toast(error.message);}}},
    el("option", {value: ""}, "整册 · 七年级上册"), data.units.map((u) => el("option", {value: u.id}, u.name)));
  unitSelect.value = mathState.unit;
  const filter = el("select", {"aria-label": "筛选数学题型", onChange: (e) => {mathState.filter = e.target.value; render();}},
    [["all", "全部题型"], ["missing", "待补核验题"], ["unassessed", "尚未诊断"], ["answered", "已有作答"]].map(([v,t]) => el("option", {value:v}, t)));
  filter.value = mathState.filter;
  const types = data.types.filter((t) => mathState.filter === "all" || (mathState.filter === "missing" && !t.verified_questions) ||
    (mathState.filter === "unassessed" && !t.attempts) || (mathState.filter === "answered" && t.attempts));
  return el("div", {},
    heading("找到下一步，从数学开始。", "按具体解题结构看证据，做一次小诊断，再安排针对练习。", "数学 · 七年级上册"),
    el("section", {class: "panel math-intro"},
      el("h2", {}, "题型地图与诊断"),
      el("div", {class: "math-controls"}, el("label", {}, "诊断范围", unitSelect),
        mathButton(mathState.session?.status === "active" ? "继续当前诊断" : "开始抽样诊断", mathStart, false)),
      el("p", {class: "note"}, "默认抽测最多10个基础或进阶题型，整册模式尽量覆盖六章。作答自动保存，刷新可继续；这一轮不加入挑战题。"),
      el("div", {class: "math-counts"},
        el("span", {}, `${data.summary.types} 个标准题型`),
        el("span", {}, `${data.summary.with_verified_questions} 个已有规则核验题`),
        el("span", {}, `${data.summary.diagnosable} 个可作基础诊断`),
        el("span", {}, `${data.summary.missing_verified} 个待补核验题`))),
    mathState.error ? el("p", {class: "inline-error", role: "alert"}, mathState.error) : null,
    mathSessionView(),
    el("section", {class: "panel"},
      el("div", {class: "section-title"}, el("h2", {}, "题型覆盖与学习证据"), filter),
      el("p", {class: "note"}, data.note),
      data.units.filter((u) => types.some((t) => t.unit_id === u.id)).map((u) =>
        el("details", {class: "course-unit", open: Boolean(mathState.unit) || mathState.filter !== "all"},
          el("summary", {}, `${u.name} · ${types.filter((t) => t.unit_id === u.id).length} 个题型`),
          types.filter((t) => t.unit_id === u.id).map((t) => el("article", {class: "math-type"},
            el("div", {class: "course-goal-title"}, el("h3", {}, t.name), el("span", {class: "tag"}, t.status)),
            el("p", {}, t.can_do),
            el("p", {class: "note"}, `核验题：基础 ${t.difficulty_counts["1"]} / 进阶 ${t.difficulty_counts["2"]} / 挑战 ${t.difficulty_counts["3"]} · ${t.coverage_status}`),
            el("p", {class: "note"}, `关联知识目标的外部候选题 ${t.candidate_goal_questions} 道，细分题型待核对。`),
            t.attempts ? el("p", {}, `${t.attempts} 道有效作答 · 独立 ${t.independent} 道 · 最近 ${t.recent.total} 道答对 ${t.recent.correct} 道`) : null,
            t.errors.map((error) => el("p", {class: "course-missing"}, `${error.feedback}（${error.count} 次）`)),
            mathEvidence(t), mathButton(t.verified_questions ? "练这个题型" : "待补核验题", () => mathPractice(t.id), true, !t.verified_questions))))),
      !types.length ? el("p", {}, "当前筛选没有题型。") : null),
    mathState.sessions.length ? el("section", {class: "panel"}, el("h2", {}, "最近的诊断"),
      mathState.sessions.map((s) => el("article", {class: "math-plan"},
        el("p", {}, `${new Date(s.created_at).toLocaleString("zh-CN")} · ${s.status === "active" ? "进行中" : s.status === "completed" ? "已完成" : "已结束"}`),
        mathButton("查看这次诊断", async () => {try {mathState.session = await api("/math/diagnostics/" + s.id); mathState.feedback = null; mathState.answer = ""; mathState.error = ""; await loadMath(); render(); window.scrollTo({top:0,behavior:"instant"});} catch (error) {toast(error.message);}}, true)))) : null);
}
