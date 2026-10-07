"use strict";
const state = {
  view: "learn",
  curriculum: null,
  student: null,
  health: null,
  history: [],
  attempt: null,
  result: null,
  hint: null,
  messages: [],
  draft: "",
  busy: false,
  chatting: false,
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
    stable = s.knowledge.filter((n) => n.status === "掌握较稳").length;
  return el(
    "div",
    { class: "stats" },
    [
      ["✓", s.completed, "题", "累计完成练习"],
      [
        "◷",
        s.completed ? Math.round((s.correct / s.completed) * 100) : "—",
        s.completed ? "%" : "",
        "作答正确率",
      ],
      ["✦", stable, "/ 12", "掌握较稳的知识点"],
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
    progress: "学习记录",
  }[state.view];
  root.replaceChildren(
    state.view === "learn"
      ? learnView()
      : state.view === "practice"
        ? practiceView()
        : progressView(),
  );
}
function learnView() {
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
async function startPractice(id) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const attempt = await api("/practice/next", { knowledge_id: id || null });
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
      el("span", {}, q.difficulty === 1 ? "基础练习" : "进阶一步"),
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
        el("p", {}, "完成第一道题后，就能看到作答记录与知识点变化。"),
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
async function exportData() {
  try {
    const history = await api("/history");
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            student: state.student,
            history: history.items,
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
    [state.curriculum, state.student, state.health] = await Promise.all([
      api("/curriculum"),
      api("/student"),
      api("/health"),
    ]);
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
init();
