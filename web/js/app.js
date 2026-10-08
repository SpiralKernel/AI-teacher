"use strict";
const state = {
  view: "learn",
  curriculum: null,
  student: null,
  health: null,
  learning: null,
  history: [],
  attempt: null,
  result: null,
  hint: null,
  messages: [],
  draft: "",
  busy: false,
  chatting: false,
  difficulty: null,
  allowChallenge: true,
  typeFilter: "practiced",
};
const root = document.querySelector("#app");
let toastTimer;
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on"))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== false)
      node.setAttribute(key, value === true ? "" : value);
  }
  children.flat().forEach((child) => {
    if (child !== null && child !== undefined && child !== false)
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  });
  return node;
}
function toast(text) {
  const n = document.querySelector("#toast");
  n.textContent = text;
  n.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    n.hidden = true;
  }, 6000);
}
async function api(path, data) {
  let response;
  try {
    response = await fetch("/api/v1" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new Error("暂时连接不到本地服务，请检查后端是否正在运行。");
  }
  const json = await response.json();
  if (!response.ok)
    throw new Error(
      typeof json.detail === "string"
        ? json.detail
        : "输入格式不正确，请检查后重试。",
    );
  return json;
}
const button = (text, action, style = "") =>
  el(
    "button",
    {
      class: "btn " + style,
      type: "button",
      onClick: action,
      disabled: state.busy,
    },
    text,
  );
const knowledge = (id) => state.curriculum.knowledge.find((n) => n.id === id);
function heading(title, text, tag = "七年级 · 上册") {
  return el(
    "div",
    { class: "greeting" },
    el(
      "div",
      {},
      el("div", { class: "eyebrow" }, "A LITTLE PROGRESS, EVERY DAY"),
      el("h1", {}, title),
      el("p", {}, text),
    ),
    el("span", { class: "tag" }, tag),
  );
}
function stats() {
  const s = state.student,
    completed = s.all_completed ?? s.completed,
    correct = s.all_correct ?? s.correct,
    stable = s.knowledge.filter((n) => n.status === "掌握较稳").length;
  return el(
    "div",
    { class: "stats" },
    [
      ["✓", completed, "题", "累计完成练习"],
      [
        "◷",
        completed ? Math.round((correct / completed) * 100) : "—",
        completed ? "%" : "",
        "作答正确率",
      ],
      ["✦", stable, "/ 12", "七上数学掌握较稳的知识点"],
    ].map(([icon, value, unit, label]) =>
      el(
        "div",
        { class: "stat" },
        el("span", { class: "stat-icon", "aria-hidden": true }, icon),
        el(
          "div",
          {},
          el("strong", {}, value),
          el("span", { class: "unit" }, unit),
          el("p", {}, label),
        ),
      ),
    ),
  );
}
function setView(view) {
  state.view = view;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function render() {
  document.querySelectorAll("[data-view]").forEach((n) => {
    n.classList.toggle("active", n.dataset.view === state.view);
    n.setAttribute(
      "aria-current",
      n.dataset.view === state.view ? "page" : "false",
    );
  });
  document.querySelector("#page-title").textContent = {
    learn: "学习地图",
    practice: "开始练习",
    materials: "拍照与试卷",
    bank: "全科题库",
    progress: "学习记录",
    settings: "设置",
  }[state.view];
  document.querySelector(".topbar > span").firstChild.textContent =
    ["practice", "materials"].includes(state.view) ? "数学 " : (state.learning?.scope.subject_name || "初中") + " ";
  document.querySelector("#learning-switch").textContent = learningLabel() + " · 设置";
  document.querySelector("#learner-scope").textContent = learningLabel();
  document.querySelector("footer span").textContent =
    state.view === "materials" ? "七上数学 / 已答试卷" : state.view === "practice" ? "七上数学 / 模板练习" : learningLabel();
  root.replaceChildren(
    state.view === "learn"
      ? learnView()
      : state.view === "practice"
        ? practiceView()
        : state.view === "bank"
          ? bankView()
          : state.view === "settings"
            ? settingsView()
          : state.view === "materials"
            ? materialView()
            : progressView(),
  );
  if (window.renderMathInElement)
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: false },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
      trust: false,
      strict: "ignore",
      maxExpand: 500,
      maxSize: 12,
    });
}
function learnView() {
  if (state.learning.book_id !== "math-7-1" || state.learning.unit_id) return stageHomeView();
  const recommended = knowledge(state.student.recommendation.knowledge_id);
  const hero = el(
    "section",
    { class: "hero" },
    el(
      "div",
      {},
      el("div", { class: "eyebrow" }, "YOUR NEXT SMALL STEP"),
      el("h2", {}, "每一步，都算进步。"),
      el(
        "p",
        {},
        state.student.completed
          ? `今天继续探索「${recommended.name}」。不用着急，先想清楚一步，再向前走。`
          : "从一道小题开始，认识自己的数学起点。这里的练习，会随着你的理解慢慢调整。",
      ),
      button(
        state.busy ? "准备中…" : "开始今日练习  ↗",
        () => startPractice(),
        "gold",
      ),
    ),
    el(
      "div",
      { class: "hero-art", "aria-hidden": true },
      el("div", { class: "orbit" }),
      el("span", { class: "math" }, "x²"),
      el("span", { class: "dot" }),
      el("span", { class: "mini" }, "a + b"),
    ),
  );
  const units = el(
    "div",
    { class: "units" },
    state.curriculum.units.map((unit, index) =>
      el(
        "section",
        { class: "unit-card" },
        el(
          "div",
          { class: "unit-heading" },
          el("span", { class: "unit-num" }, String(index + 1).padStart(2, "0")),
          el("div", {}, el("h3", {}, unit.name), el("p", {}, unit.description)),
        ),
        state.student.knowledge
          .filter((k) => k.unit_id === unit.id)
          .map((k) =>
            el(
              "button",
              {
                class: "knowledge",
                type: "button",
                disabled: state.busy,
                onClick: () => startPractice(k.id),
                "aria-label": `${k.name}，${k.status}，开始专项练习`,
              },
              el(
                "span",
                {
                  class: "mark " + (k.status === "掌握较稳" ? "mastered" : ""),
                },
                k.status === "掌握较稳" ? "✓" : "·",
              ),
              el("span", { class: "name" }, k.name),
              el("small", {}, k.status),
              el("span", { class: "arrow", "aria-hidden": true }, "↗"),
            ),
          ),
      ),
    ),
  );
  return el(
    "div",
    {},
    heading("你好，今天也向前一步。", "把不懂的地方，变成下一次进步的起点。"),
    learningOverview(),
    hero,
    stats(),
    el(
      "div",
      { class: "section-title" },
      el("h2", {}, "你的数学地图"),
      el("p", {}, "4 个学习单元 · 12 个起步知识点"),
    ),
    units,
    el(
      "p",
      { class: "note" },
      el("span", { class: "symbol" }, "ⓘ"),
      "这是项目自编的入门范围，可按教材调整。掌握度由真实作答更新；题目经过程序校验，尚未经过教师审定。",
    ),
  );
}
async function refreshStudent() {
  state.student = await api("/student");
}
async function startPractice(id, options = {}) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const attempt = await api("/practice/next", {
      knowledge_id: id || null,
      difficulty: state.difficulty,
      allow_challenge: state.allowChallenge,
      ...options,
    });
    if (state.attempt?.attempt_id !== attempt.attempt_id) {
      state.result = null;
      state.hint = null;
      state.messages = [];
      state.draft = "";
    }
    state.attempt = attempt;
    state.view = "practice";
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    render();
  }
}
function practiceView() {
  if (!state.attempt)
    return el(
      "div",
      {},
      heading("把问题，拆成一小步。", "不懂就问，不必一次全做对。"),
      difficultyControls(),
      el(
        "div",
        { class: "empty" },
        el("h2", {}, "从你的起点开始"),
        el(
          "p",
          {},
          "先做一题基础诊断。我们会记录你会的内容，也一起找到需要再练一练的地方。",
        ),
        button("开始第一题  ↗", () => startPractice()),
      ),
    );
  const a = state.attempt,
    q = a.question,
    k = knowledge(q.knowledge_id);
  const input = el("input", {
    class: "answer-input",
    id: "answer",
    name: "answer",
    type: "text",
    inputmode: "text",
    autocomplete: "off",
    maxlength: 64,
    placeholder: "输入数值，如 -3、0.5 或 1/2",
    disabled: !!state.result || state.busy,
    required: true,
    "aria-describedby": "answer-help",
  });
  input.value = state.draft;
  input.addEventListener("input", () => {
    state.draft = input.value;
  });
  const errorText = el("p", { class: "inline-error", role: "alert" });
  const form = el(
    "form",
    {
      onSubmit: async (event) => {
        event.preventDefault();
        if (state.busy || state.result) return;
        const value = input.value;
        state.busy = true;
        form.querySelectorAll("button").forEach((n) => (n.disabled = true));
        input.disabled = true;
        try {
          state.result = await api(`/attempts/${a.attempt_id}/answer`, {
            answer: value,
          });
          await refreshStudent();
          render();
        } catch (error) {
          errorText.textContent = error.message;
          input.disabled = false;
          form.querySelectorAll("button").forEach((n) => (n.disabled = false));
        } finally {
          state.busy = false;
          if (state.result) render();
        }
      },
    },
    el("label", { class: "answer-label", for: "answer" }, "你的答案"),
    input,
    el(
      "p",
      { id: "answer-help", class: "note" },
      "只填数值，不需要写单位。分数和等值小数都可以。",
    ),
    errorText,
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          class: "btn",
          type: "submit",
          disabled: !!state.result || state.busy,
        },
        state.result ? "已完成作答" : "提交答案  →",
      ),
      button("给我一点提示", () => getHint(), "ghost"),
    ),
  );
  if (state.result) {
    input.value = state.result.answer;
    form.replaceChildren(
      el(
        "p",
        { class: "assessment" },
        "这道题已完成。可以查看解析、继续讨论，或开始下一题。",
      ),
    );
  }
  const questionPanel = el(
    "section",
    { class: "panel" },
    el(
      "div",
      { class: "question-meta" },
      el("span", { class: "tag" }, k.name),
      el(
        "span",
        {},
        { 1: "基础练习", 2: "进阶一步", 3: "挑战变式" }[q.difficulty],
      ),
      el(
        "span",
        {},
        (state.student.question_types || []).find((t) => t.id === q.type_id)
          ?.name || "",
      ),
      el("span", {}, "· 数值作答"),
    ),
    el("h2", { class: "question-text" }, q.stem),
    form,
    state.hint ? el("div", { class: "hint-box" }, state.hint) : null,
    state.result ? resultView() : null,
  );
  const left = el(
    "div",
    {},
    questionPanel,
    el(
      "div",
      { class: "goal" },
      el("h3", {}, "这一题，我们想学会"),
      el("p", {}, k.goal),
    ),
    el(
      "p",
      { class: "note" },
      "题目来源：原创数学模板 · 答案经独立数学规则校验。",
    ),
  );
  return el(
    "div",
    {},
    heading("专注眼前这一小步。", a.reason),
    difficultyControls(),
    el("div", { class: "practice-layout" }, left, tutorView()),
  );
}
function resultView() {
  const r = state.result;
  return el(
    "div",
    { class: "result " + (r.correct ? "" : "wrong") },
    el(
      "h3",
      {},
      r.correct ? "✓ 答对了，继续保持思考。" : "再看一步，你会更清楚。",
    ),
    el("p", { class: "assessment" }, `参考答案：${r.answer}`),
    r.error ? el("p", { class: "feedback" }, r.error.feedback) : null,
    el(
      "ol",
      {},
      r.steps.map((s) => el("li", {}, s)),
    ),
    el(
      "p",
      { class: "muted" },
      r.repeated_question
        ? "这道题已做过，记录本次作答，不重复增加掌握证据。"
        : r.assisted
          ? "本题使用过提示或辅导，系统会降低正确作答的掌握证据权重。"
          : "这次作答已保存，并更新了知识点掌握证据。",
    ),
    el(
      "div",
      { class: "actions" },
      button("再练一道  →", () =>
        startPractice(state.attempt.question.knowledge_id),
      ),
      button("智能推荐", () => startPractice(), "light"),
    ),
  );
}
async function getHint() {
  if (state.busy || state.result) return;
  state.busy = true;
  try {
    const r = await api(`/attempts/${state.attempt.attempt_id}/hint`, {});
    state.hint = r.hint;
    state.attempt.hint_used = true;
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
    render();
  }
}
function tutorView() {
  const chat = el(
    "div",
    { class: "chat", role: "log", "aria-label": "辅导对话" },
    el(
      "div",
      { class: "bubble" },
      "你好，我会陪你把这一题想明白。你可以说说：卡在哪一步了？",
      el(
        "small",
        {},
        state.health.ai_configured
          ? "DeepSeek 已配置 · 按当前知识点辅导"
          : "题库提示模式 · 配置 API Key 后启用 AI 对话",
      ),
    ),
    state.messages.map((m) =>
      el(
        "div",
        { class: "bubble " + (m.role === "user" ? "user" : "") },
        m.text,
        m.notice ? el("small", {}, m.notice) : null,
      ),
    ),
  );
  const textarea = el("textarea", {
    placeholder: "例如：为什么减去负数要变成加法？",
    maxlength: 1200,
    required: true,
    "aria-label": "向学习伙伴提问",
    disabled: state.chatting,
  });
  const form = el(
    "form",
    {
      class: "chat-form",
      onSubmit: async (event) => {
        event.preventDefault();
        const message = textarea.value.trim();
        if (!message || state.chatting) return;
        state.chatting = true;
        const attemptId = state.attempt.attempt_id;
        state.messages.push({ role: "user", text: message });
        render();
        try {
          const r = await api(`/attempts/${attemptId}/tutor`, { message });
          if (state.attempt?.attempt_id === attemptId) {
            state.messages.push({
              role: "assistant",
              text: r.reply + "\n\n" + r.check_question,
              notice: r.notice,
            });
            state.attempt.hint_used = true;
          }
        } catch (e) {
          toast(e.message);
        } finally {
          state.chatting = false;
          render();
        }
      },
    },
    textarea,
    el(
      "button",
      { class: "btn light", type: "submit", disabled: state.chatting },
      state.chatting ? "正在思考…" : "一起想一想  ↗",
    ),
  );
  return el(
    "section",
    { class: "panel" },
    el(
      "div",
      { class: "tutor-heading" },
      el("h2", {}, "✦ 数学学习伙伴"),
      el(
        "span",
        { class: "ai-status" },
        state.health.ai_configured ? "DeepSeek" : "题库提示",
      ),
    ),
    el("p", { class: "tutor-subtitle" }, "先给思路，再一起检查理解。"),
    chat,
    form,
    el(
      "p",
      { class: "note" },
      "不需要提供个人信息。AI 模式会将本题、掌握摘要与本题对话发送至 DeepSeek。使用辅导会标记本题为提示作答。",
    ),
  );
}
function progressView() {
  const list = state.history.length
    ? el(
        "section",
        { class: "panel" },
        state.history.map((item) =>
          el(
            "article",
            { class: "record" },
            el(
              "span",
              { class: "indicator " + (item.result.correct ? "" : "wrong") },
              item.result.correct ? "✓" : "↺",
            ),
            el(
              "div",
              { class: "record-body" },
              el("h3", {}, item.question.stem),
              el(
                "p",
                {},
                `${knowledge(item.question.knowledge_id).name} · ${new Date(item.submitted_at).toLocaleString("zh-CN")} · ${item.result.assisted ? "使用过辅导" : "独立作答"}`,
              ),
              el(
                "details",
                {},
                el("summary", {}, "查看答案与解析"),
                el(
                  "p",
                  {},
                  `你的答案：${item.answer}　参考答案：${item.result.answer}`,
                ),
                el(
                  "ol",
                  {},
                  item.result.steps.map((s) => el("li", {}, s)),
                ),
              ),
            ),
          ),
        ),
      )
    : el(
        "div",
        { class: "empty" },
        el("h2", {}, "你的进步，会在这里留下痕迹。"),
        el(
          "p",
          {},
          state.student.imported_completed
            ? "试卷评价已计入上方题型画像；在线练习记录会显示在这里。"
            : "完成第一道题后，就能看到作答记录与知识点变化。",
        ),
        button("开始练习", () => startPractice()),
      );
  return el(
    "div",
    {},
    heading(
      "进步，有迹可循。",
      "这里记录你的每一次尝试，不只记录答对的那一次。",
    ),
    stats(),
    typeProfilePanel(),
    state.student.bank_summary?.length
      ? el(
          "section",
          { class: "panel" },
          el("h2", {}, "全科题库学习记录"),
          el(
            "p",
            { class: "assessment" },
            `已保存 ${state.student.bank_summary.reduce((n, s) => n + s.completed, 0)} 次全科作答；各科知识点与题型画像在全科题库中查看。`,
          ),
          button("查看全科画像", async () => {
            await loadBank();
            setView("bank");
          }),
        )
      : null,
    el("div", { class: "section-title" }, el("h2", {}, "值得再关注的地方")),
    state.student.weak_patterns.length
      ? el(
          "div",
          { class: "weak-list" },
          state.student.weak_patterns.map((p) =>
            el(
              "span",
              { class: "weak-chip" },
              p.feedback + `（${p.count} 次）`,
            ),
          ),
        )
      : el(
          "p",
          { class: "note" },
          "目前还没有记录到错误模式。随着练习增加，我们会获得更多证据。",
        ),
    el("p", { class: "assessment" }, state.student.assessment_note),
    el(
      "p",
      { class: "note" },
      `已核对并计入档案的试卷题：${state.student.imported_completed || 0} 道。试卷原页与逐题评价保存在“拍照与试卷”。`,
    ),
    button(
      "查看试卷分析  ↗",
      async () => {
        await loadMaterials();
        setView("materials");
      },
      "light",
    ),
    el(
      "div",
      { class: "section-title", style: "margin-top:28px" },
      el("h2", {}, "最近的练习"),
      el("p", {}, "显示最近 50 次"),
    ),
    list,
    el(
      "div",
      { class: "export" },
      button("导出我的学习记录  ↓", exportData, "ghost"),
    ),
  );
}
function difficultyControls() {
  const select = el("select", {
    id: "practice-difficulty",
    onChange: (e) => {
      state.difficulty = e.target.value ? Number(e.target.value) : null;
    },
  });
  for (const [value, label] of [
    ["", "自动选择"],
    ["1", "基础"],
    ["2", "进阶"],
    ["3", "挑战"],
  ])
    select.append(el("option", { value }, label));
  select.value = state.difficulty || "";
  return el(
    "div",
    { class: "difficulty-controls" },
    el("label", { for: "practice-difficulty" }, "下一题难度"),
    select,
    el(
      "label",
      { class: "check-line" },
      el("input", {
        type: "checkbox",
        checked: state.allowChallenge,
        onChange: async (e) => {
          try { await applyLearningPreferences({allow_challenge: e.target.checked}); }
          catch (error) { toast(error.message); }
          render();
        },
      }),
      "自动模式随机混入挑战题（15%）",
    ),
    el("small", {}, "基础与挑战按不同题型记录；难度标签尚未经过学生群体校准。"),
  );
}
function typeProfilePanel() {
  const types = state.student.question_types || [];
  const filter = el(
    "select",
    {
      "aria-label": "筛选题型画像",
      onChange: (e) => {
        state.typeFilter = e.target.value;
        render();
      },
    },
    [
      ["practiced", "已练习与 AI 新建"],
      ["all", "全部题型"],
      ["weak", "需要巩固"],
      ["ai", "AI 新建题型"],
    ].map(([value, label]) => el("option", { value }, label)),
  );
  filter.value = state.typeFilter;
  const selected = types.filter(
    (t) =>
      state.typeFilter === "all" ||
      (state.typeFilter === "ai" && t.source === "ai") ||
      (state.typeFilter === "weak" && t.attempts > 0 && t.mastery < 0.6) ||
      (state.typeFilter === "practiced" &&
        (t.attempts > 0 || t.source === "ai")),
  );
  return el(
    "section",
    { class: "type-profile" },
    el("div", { class: "section-title" }, el("h2", {}, "题型画像"), filter),
    el(
      "p",
      { class: "assessment" },
      "同一知识点下的不同解题结构分开记录。AI 可识别并新建题型；新分类带来源标记，可在试卷核对时纠正。",
    ),
    selected.length
      ? el(
          "div",
          { class: "type-grid" },
          selected.map((t) =>
            el(
              "article",
              { class: "type-card" },
              el(
                "div",
                { class: "section-title" },
                el("h3", {}, t.name),
                el("span", { class: "ai-status" }, t.status),
              ),
              el(
                "p",
                {},
                `${t.attempts} 次有效证据 · ${t.correct} 次答对 · ${t.mastery === null ? "待诊断" : `掌握估计 ${Math.round(t.mastery * 100)}%`}`,
              ),
              el(
                "p",
                { class: "type-origin" },
                t.source === "ai"
                  ? "AI 新建分类 · 尚待分类校验"
                  : "原创模板题型",
              ),
              el(
                "div",
                { class: "actions" },
                t.id.startsWith("template:") || t.id.startsWith("challenge:")
                  ? button(
                      "练这个题型",
                      () =>
                        startPractice(t.knowledge_ids[0], {
                          question_type_id: t.id,
                        }),
                      "light",
                    )
                  : t.knowledge_ids.length
                    ? button(
                        "练关联知识点",
                        () => startPractice(t.knowledge_ids[0]),
                        "light",
                      )
                    : el("small", {}, "暂无对应练习，等待补充题目"),
              ),
            ),
          ),
        )
      : el(
          "p",
          { class: "note" },
          "此范围暂时没有题型证据。完成练习或导入已作答试卷后会更新。",
        ),
  );
}
async function exportData() {
  try {
    const history = await api("/history");
    const list = await api("/imports");
    const imports = await Promise.all(
      list.items
        .filter((x) => x.status === "confirmed")
        .map((x) => api(`/imports/${x.id}`)),
    );
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            student: state.student,
            history: history.items,
            imports,
            bank: await api("/bank/export"),
            learning_preferences: state.learning,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "AI-teacher-learning.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    toast(e.message);
  }
}
document.querySelectorAll("[data-view]").forEach((n) =>
  n.addEventListener("click", async () => {
    if (state.busy) return;
    if (n.dataset.view === "settings") { await openSettings(); return; }
    if (n.dataset.view === "practice" && (state.learning.book_id !== "math-7-1" || state.learning.unit_id)) {
      await openCurrentBank();
      return;
    }
    if (n.dataset.view === "materials") {
      try {
        await loadMaterials();
      } catch (e) {
        toast(e.message);
        return;
      }
    }
    if (n.dataset.view === "bank") {
      try {
        await loadBank();
      } catch (e) {
        toast(e.message);
        return;
      }
    }
    if (n.dataset.view === "progress") {
      try {
        state.history = (await api("/history")).items;
        await refreshStudent();
      } catch (e) {
        toast(e.message);
        return;
      }
    }
    setView(n.dataset.view);
  }),
);
async function init() {
  try {
    [state.curriculum, state.student, state.health, state.learning] = await Promise.all([
      api("/curriculum"),
      api("/student"),
      api("/health"),
      api("/courses/preferences"),
    ]);
    useLearningPreferences(state.learning);
    render();
  } catch (e) {
    root.replaceChildren(
      el(
        "div",
        { class: "empty" },
        el("h2", {}, "学习空间暂时没有连接上"),
        el("p", {}, e.message),
        button("重新连接", init),
      ),
    );
  }
}
document.querySelector("#learning-switch").addEventListener("click", () => {
  if (state.learning && !state.busy) openSettings();
});
init();
