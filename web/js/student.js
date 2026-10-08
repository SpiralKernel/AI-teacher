import { createTeacherUI } from "./teacher.js";
import { createImportUI } from "./imports.js";
import { createReportUI } from "./report.js";
/* 学生页面仅依赖 study 与 auth API；凭证由 HttpOnly 会话 Cookie 保存。 */
(() => {
  "use strict";
  const root = document.querySelector("#root"),
    notice = document.querySelector("#notice");
  const S = {
    student: null,
    home: null,
    mode: "ai",
    authMode: "login",
    aiPanel: null,
    work: null,
    result: null,
    unit: "",
    written: false,
    challenge: true,
    aiType: "",
    messages: [],
    draft: "",
    files: [],
    answer: "",
    choices: [],
    review: null,
    epoch: 0,
    busy: false,
  };
  const ui = {
    S,
    el,
    btn,
    field,
    select,
    api,
    action,
    error,
    refresh,
    render,
    math,
  };
  const teacherUI = createTeacherUI(ui);
  const importUI = createImportUI(ui, teacherUI);
  const reportUI = createReportUI(ui);
  let noticeTimer;
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (val === null || val === undefined || val === false) continue;
      if (key.startsWith("on"))
        n.addEventListener(key.slice(2).toLowerCase(), val);
      else if (key === "class") n.className = val;
      else if (key in n) n[key] = val;
      else n.setAttribute(key, val);
    }
    for (const c of children.flat(Infinity)) {
      if (c !== null && c !== undefined && c !== false)
        n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  function error(message) {
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.hidden = true), 7000);
  }
  async function api(path, body, method) {
    const epoch = S.epoch;
    const options = {
      method: method || (body ? "POST" : "GET"),
      credentials: "same-origin",
      headers: {},
    };
    if (body instanceof FormData) options.body = body;
    else if (body) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch("/api/v1" + path, options);
    const value = await res.json();
    if (epoch !== S.epoch) throw new Error("学习账号已切换，请重新操作。");
    if (!res.ok) {
      if (res.status === 401 && S.student) {
        reset();
        render();
      }
      throw new Error(
        typeof value.detail === "string"
          ? value.detail
          : "输入有误，请检查后重试。",
      );
    }
    return value;
  }
  async function action(fn) {
    if (S.busy) return;
    S.busy = true;
    notice.hidden = true;
    root.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (e) {
      error(e.message);
    } finally {
      S.busy = false;
      root.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }
  function btn(text, fn, cls = "") {
    return el(
      "button",
      { type: "button", class: cls, onClick: () => action(fn) },
      text,
    );
  }
  function field(text, input) {
    return el("label", { class: "field" }, el("span", {}, text), input);
  }
  function select(label, options, value, onChange) {
    const n = el(
      "select",
      { "aria-label": label, onChange: (e) => onChange(e.target.value) },
      options.map(([v, t]) => el("option", { value: v }, t)),
    );
    n.value = value;
    return n;
  }
  function brand() {
    return el(
      "div",
      { class: "brand" },
      el("span", { class: "brand-icon", "aria-hidden": "true" }, "学"),
      "AI-teacher",
    );
  }
  function math(n) {
    if (window.renderMathInElement)
      window.renderMathInElement(n, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
        trust: false,
      });
  }
  function reset() {
    S.epoch++;
    teacherUI.reset();
    importUI.reset();
    reportUI.reset();
    S.aiPanel = null;
    Object.assign(S, {
      student: null,
      home: null,
      work: null,
      result: null,
      messages: [],
      files: [],
      draft: "",
      answer: "",
      choices: [],
      review: null,
      aiType: "",
      mode: "ai",
      unit: "",
      written: false,
    });
    notice.hidden = true;
  }
  async function load() {
    const session = await api("/auth/session");
    S.student = session.student;
    S.authMode = session.needs_setup ? "register" : "login";
    S.needsSetup = session.needs_setup;
    if (S.student) S.home = await api("/study/home");
    render();
  }
  function stageFields(grade = 7, term = 1) {
    const g = select(
      "年级",
      [
        [7, "七年级"],
        [8, "八年级"],
        [9, "九年级"],
      ],
      grade,
      () => {},
    );
    const t = select(
      "学期",
      [
        [1, "上学期"],
        [2, "下学期"],
      ],
      term,
      () => {},
    );
    return {
      node: el(
        "div",
        { class: "split-fields" },
        field("年级", g),
        field("学期", t),
      ),
      get: () => ({ grade: Number(g.value), term: Number(t.value) }),
    };
  }
  function login() {
    const register = S.authMode === "register";
    const name = el("input", {
      name: "username",
      autocomplete: "username",
      minLength: 2,
      maxLength: 40,
      required: true,
      placeholder: "输入用户名",
    });
    const password = el("input", {
      name: "password",
      type: "password",
      autocomplete: register ? "new-password" : "current-password",
      minLength: 8,
      maxLength: 128,
      required: true,
      placeholder: "至少 8 位",
    });
    const nickname = el("input", {
      name: "nickname",
      autocomplete: "nickname",
      maxLength: 30,
      placeholder: "你希望怎样被称呼？",
    });
    const stage = stageFields();
    const form = el(
      "form",
      {
        onSubmit: (e) => {
          e.preventDefault();
          action(async () => {
            const body = { username: name.value, password: password.value };
            if (register)
              Object.assign(body, stage.get(), {
                nickname: nickname.value.trim() || "学习者",
              });
            await api(register ? "/auth/register" : "/auth/login", body);
            password.value = "";
            await load();
          });
        },
      },
      field("用户名", name),
      field("密码", password),
      register ? field("称呼", nickname) : null,
      register ? stage.node : null,
      register && S.needsSetup
        ? el(
            "p",
            { class: "tiny" },
            "这是本机第一个账号，会继承之前的答题记录。",
          )
        : null,
      el(
        "button",
        { type: "submit", class: "primary full" },
        register ? "创建并开始学习" : "进入我的学习空间",
      ),
    );
    return el(
      "main",
      { class: "login-shell" },
      el(
        "section",
        { class: "welcome" },
        brand(),
        el("p", { class: "eyebrow" }, "从理解开始"),
        el("h1", {}, "有问题，", el("br"), "就从这里问起。"),
        el(
          "p",
          {},
          "问知识、拍题目、导入练习。AI老师陪你理解，题库记录独立表现，家长也能看见每一步进展。",
        ),
        el(
          "div",
          { class: "steps" },
          el("span", {}, el("b", {}, "1"), "题库练习"),
          el("span", {}, el("b", {}, "2"), "AI答疑"),
          el("span", {}, el("b", {}, "3"), "独立复测"),
        ),
      ),
      el(
        "section",
        { class: "card login-card" },
        el("h2", {}, register ? "建立你的学习空间" : "欢迎回来"),
        el(
          "p",
          { class: "subtle" },
          register
            ? "选好年级和学期，先从数学开始。"
            : "登录后继续自己的练习与学习记录。",
        ),
        el(
          "div",
          { class: "login-tabs" },
          btn(
            "登录",
            () => {
              S.authMode = "login";
              render();
            },
            !register ? "badge" : "quiet",
          ),
          btn(
            "新建学生",
            () => {
              S.authMode = "register";
              render();
            },
            register ? "badge" : "quiet",
          ),
        ),
        form,
      ),
    );
  }
  async function refresh() {
    S.home = await api("/study/home");
  }
  async function start(typeId = null) {
    const w = await api("/study/next", {
      unit_id: typeId ? null : S.unit || null,
      type_id: typeId,
      written: typeId ? false : S.written,
      allow_challenge: S.challenge,
    });
    Object.assign(S, {
      mode: "bank",
      work: w,
      result: null,
      answer: "",
      choices: [],
      files: [],
      review: w.review?.status === "review" ? w.review : null,
    });
    render();
    document
      .querySelector("#work")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function settings() {
    const stage = stageFields(S.student.grade, S.student.term);
    const shade = el("div", { class: "dialog-shade" });
    function close() {
      shade.remove();
      document.removeEventListener("keydown", key);
      document.querySelector("#settings-button")?.focus();
    }
    function key(e) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const items = [...shade.querySelectorAll("button,select")].filter(
          (n) => !n.disabled,
        );
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    shade.append(
      el(
        "section",
        {
          class: "card dialog-card",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "settings-title",
        },
        el(
          "div",
          { class: "kicker" },
          el("h2", { id: "settings-title" }, "学习设置"),
          btn("关闭", close, "quiet"),
        ),
        el("p", { class: "subtle" }, `${S.student.nickname} · 数学`),
        stage.node,
        el(
          "p",
          { class: "subtle" },
          "只展示所选年级、学期的题目。切换阶段会保留之前的记录。",
        ),
        btn(
          "保存学习阶段",
          async () => {
            await api("/auth/stage", stage.get());
            reset();
            close();
            await load();
          },
          "primary full",
        ),
      ),
    );
    root.append(shade);
    shade.querySelector("select").focus();
  }
  function bankPage() {
    const home = S.home;
    const chapter = select(
      "练习章节",
      [["", "本学期全部章节"], ...home.book.units.map((u) => [u.id, u.name])],
      S.unit,
      (v) => (S.unit = v),
    );
    const format = select(
      "作答方式",
      [
        ["numeric", "短答练习"],
        ["written", "文字 / 拍照题"],
      ],
      S.written ? "written" : "numeric",
      (v) => (S.written = v === "written"),
    );
    return el(
      "section",
      {},
      el(
        "div",
        { class: "intro" },
        el(
          "div",
          {},
          el("p", { class: "eyebrow" }, "题库 · 用练习看清自己"),
          el("h1", {}, "今天，练一点。"),
          el(
            "p",
            { class: "subtle" },
            "每种题分开记录，慢慢积累可靠的学习状态。",
          ),
        ),
        el(
          "div",
          { class: "intro-stat" },
          el("strong", {}, home.completed),
          "本学期已完成",
        ),
      ),
      el(
        "section",
        { class: "card" },
        el(
          "div",
          { class: "practice-start" },
          field("练习章节", chapter),
          field("作答方式", format),
          btn(
            S.work && !S.result ? "继续练习" : "开始练习",
            () => start(),
            "primary",
          ),
        ),
        el(
          "label",
          { class: "check" },
          el("input", {
            type: "checkbox",
            checked: S.challenge,
            onChange: (e) => (S.challenge = e.target.checked),
          }),
          "偶尔来一道挑战题",
        ),
        el(
          "p",
          { class: "tiny" },
          home.book.id === "math-7-1"
            ? "短答题的答案已检查，独立完成后会更新题型状态。文字 / 拍照题可提交完整过程。"
            : "当前阶段使用与学习内容匹配的来源题。答案还需核对的题目会保存记录，暂不用于判断掌握状态。",
        ),
      ),
      S.work ? workspace() : null,
      progress(),
    );
  }
  function workspace() {
    const w = S.work,
      q = w.question;
    const node = el(
      "section",
      { class: "card", id: "work" },
      el(
        "div",
        { class: "kicker" },
        el(
          "span",
          { class: "badge" },
          q.difficulty === 3 ? "挑战题" : "题库练习",
        ),
        el(
          "span",
          { class: "subtle" },
          w.type_name || "独立完成，才能看清掌握情况",
        ),
      ),
      el("div", { class: "question-stem" }, q.stem),
    );
    node.append(
      btn(
        "问问 AI",
        () => teacherUI.open({ source: w.source, attempt_id: w.attempt_id }),
        "ask-teacher-button",
      ),
    );
    if (S.result) {
      const r = S.result;
      node.append(
        el(
          "div",
          { class: `result ${r.correct ? "" : "wrong"}` },
          el(
            "h3",
            {},
            r.verdict === "uncertain"
              ? "这次暂不判断正误"
              : r.verdict === "partial"
                ? "部分正确，看看还差哪一步"
                : r.correct
                  ? "这道题答对了。"
                  : "这道题值得再看一步。",
          ),
          el("p", {}, `参考答案：${r.answer}`),
          el(
            "ol",
            {},
            (r.steps || []).map((t) => el("li", {}, t)),
          ),
          r.error ? el("p", { class: "subtle" }, r.error.feedback) : null,
          el(
            "p",
            { class: "tiny" },
            w.source === "verified" && r.evidence_weight > 0 && !r.assisted
              ? "已保存独立作答记录。"
              : w.source === "bank"
                ? "已保存作答记录。来源答案或 AI 评阅经核验前，不计入可靠题量。"
                : "记录已保存；重复或辅助作答不增加独立题量。",
          ),
          el(
            "div",
            { class: "actions" },
            btn("下一题", () => start(), "primary"),
            btn(
              "继续问 AI",
              () =>
                teacherUI.open({ source: w.source, attempt_id: w.attempt_id }),
              "quiet",
            ),
          ),
        ),
      );
      return node;
    }
    if (q.answer_mode === "numeric") {
      const input = el("input", {
        "aria-label": "你的答案",
        value: S.answer,
        maxLength: 64,
        required: true,
        autocomplete: "off",
        placeholder: "填写数值，例如 -3 或 1/2",
        onInput: (e) => (S.answer = e.target.value),
      });
      node.append(
        el(
          "form",
          {
            class: "answer-line",
            onSubmit: (e) => {
              e.preventDefault();
              action(async () => {
                S.result = await api(`/attempts/${w.attempt_id}/answer`, {
                  answer: S.answer,
                });
                await refresh();
                render();
              });
            },
          },
          field("你的答案", input),
          el("button", { type: "submit", class: "primary" }, "提交答案"),
        ),
      );
    } else if (q.answer_mode === "choice") {
      const multi = q.kind === "multiple_choice";
      node.append(
        el(
          "div",
          { class: "choices" },
          (q.options || []).map((o) =>
            el(
              "label",
              { class: "choice" },
              el("input", {
                type: multi ? "checkbox" : "radio",
                name: "option",
                value: o.key,
                checked: S.choices.includes(o.key),
                onChange: (e) => {
                  if (multi)
                    S.choices = e.target.checked
                      ? [...S.choices, o.key]
                      : S.choices.filter((v) => v !== o.key);
                  else S.choices = [o.key];
                },
              }),
              el("span", {}, `${o.key}. ${o.text}`),
            ),
          ),
        ),
        btn(
          "提交答案",
          async () => {
            if (!S.choices.length) throw new Error("请先选择答案。");
            S.result = await api(`/bank/attempts/${w.attempt_id}/answer`, {
              answer: S.choices.join(""),
            });
            await refresh();
            render();
          },
          "primary",
        ),
      );
    } else {
      const input = el("textarea", {
        "aria-label": "完整解答",
        value: S.answer,
        maxLength: 12000,
        placeholder: "写下你的推理和步骤，或拍照上传手写答案。",
        onInput: (e) => (S.answer = e.target.value),
      });
      node.append(
        field("你的解答", input),
        photoInput("上传手写答案"),
        el(
          "p",
          { class: "tiny" },
          "AI 会先转写并评阅。请核对转写和正误后再保存；评阅不直接增加可靠题量。",
        ),
        btn(
          S.review ? "重新评阅" : "提交 AI 评阅",
          async () => {
            const form = new FormData();
            form.append("answer", S.answer);
            S.files.forEach((f) => form.append("files", f));
            S.review = await api(`/bank/attempts/${w.attempt_id}/assess`, form);
            render();
          },
          "primary",
        ),
      );
      if (S.review) node.append(reviewPanel());
    }
    return node;
  }
  function photoInput(label) {
    const input = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      multiple: true,
      "aria-label": label,
      onChange: (e) => {
        S.files = [...e.target.files];
        if (S.files.length > 4) {
          S.files = [];
          e.target.value = "";
          error("每次最多选择 4 张图片。");
        }
      },
    });
    return el(
      "div",
      {},
      field(label, input),
      el(
        "p",
        { class: "file-note" },
        S.files.length
          ? `已选择 ${S.files.length} 张；重新选择会替换。`
          : "支持 JPG、PNG、WebP，最多 4 张，单张 20MB。",
      ),
    );
  }
  function reviewPanel() {
    const r = S.review,
      a = r.assessment;
    if (r.status !== "review" || !a)
      return el("p", { class: "subtle" }, r.error || "请重新提交评阅。");
    const transcribed = el("textarea", {
      "aria-label": "核对转写",
      value: a.transcribed_answer,
      maxLength: 12000,
    });
    const verdict = select(
      "你确认的结果",
      [
        ["", "请选择核对结果"],
        ["correct", "正确"],
        ["incorrect", "错误"],
        ["partial", "部分正确"],
        ["uncertain", "无法判断"],
      ],
      "",
      () => {},
    );
    const checked = el("input", { type: "checkbox" });
    return el(
      "section",
      { class: "review" },
      el("h3", {}, "核对 AI 评阅"),
      el("p", {}, a.reason),
      field("核对转写", transcribed),
      field("你确认的结果", verdict),
      el("label", { class: "check" }, checked, "我已核对图片转写与评价"),
      btn(
        "确认并保存",
        async () => {
          if (!checked.checked || !verdict.value)
            throw new Error("请核对转写与评价，并选择核对结果。");
          S.result = await api(`/bank/attempts/${S.work.attempt_id}/confirm`, {
            review_id: r.id,
            reviewed: true,
            verdict: verdict.value,
            transcribed_answer: transcribed.value,
            count_evidence: false,
          });
          await refresh();
          render();
        },
        "primary",
      ),
    );
  }
  function progress() {
    const groups = S.home.types;
    return el(
      "details",
      { class: "card progress" },
      el("summary", {}, "看看我的题型状态"),
      el(
        "p",
        { class: "subtle" },
        "每种题至少独立完成 5 道不同的有效练习，再结合最近表现判断。未评估不代表不会。",
      ),
      groups.length
        ? groups.map((t) =>
            el(
              "div",
              { class: "type-row" },
              el(
                "div",
                {},
                el("h3", {}, t.name),
                el(
                  "p",
                  {},
                  `${t.independent_count} 道有效独立练习${t.recorded > t.independent_count ? ` · 共记录 ${t.recorded} 次作答` : ""} · ${t.reason}`,
                ),
              ),
              el(
                "span",
                { class: `badge ${t.status === "需要补强" ? "warn" : ""}` },
                t.independent_count >= 5
                  ? t.status
                  : t.learning_status || t.status,
              ),
            ),
          )
        : el(
            "p",
            { class: "empty" },
            "先完成一些当前阶段的练习。来源题型会随作答记录加入，未核验题暂不作可靠判断。",
          ),
      el("p", { class: "tiny" }, S.home.note),
    );
  }
  function render() {
    root.replaceChildren();
    if (!S.student) {
      root.append(login());
      return;
    }
    const top = el(
      "header",
      { class: "topbar" },
      brand(),
      el(
        "div",
        { class: "account" },
        el(
          "span",
          { class: "stage-label" },
          `${S.student.nickname} · ${S.student.grade}年级${S.student.term === 1 ? "上" : "下"}册 · 数学`,
        ),
        btn("学情报告", () => reportUI.open(), "report-entry-button"),
        el(
          "button",
          {
            id: "settings-button",
            type: "button",
            class: "quiet",
            onClick: () => action(settings),
          },
          "学习设置",
        ),
        btn(
          "退出",
          async () => {
            await api("/auth/logout", {});
            reset();
            await load();
          },
          "quiet",
        ),
      ),
    );
    const bankTab = btn("题库", () => {
      S.mode = "bank";
      render();
    });
    bankTab.setAttribute("role", "tab");
    bankTab.setAttribute("aria-selected", String(S.mode === "bank"));
    const aiTab = btn("AI老师", async () => {
      await refresh();
      S.mode = "ai";
      S.aiPanel = null;
      render();
    });
    aiTab.setAttribute("role", "tab");
    aiTab.setAttribute("aria-selected", String(S.mode === "ai"));
    root.append(
      top,
      el(
        "main",
        { class: "shell" },
        el(
          "nav",
          { class: "tabs", role: "tablist", "aria-label": "学习模式" },
          aiTab,
          bankTab,
        ),
        S.mode === "report"
          ? reportUI.page()
          : S.mode === "bank"
            ? bankPage()
            : S.aiPanel === "imports"
              ? importUI.page()
              : teacherUI.page(),
        el(
          "footer",
          { class: "footer" },
          "AI-teacher · 一步一步学会",
          el("br"),
          "题库看状态，AI 帮理解。",
        ),
      ),
    );
    const panel = teacherUI.panel();
    if (panel) root.append(panel);
    math(root);
  }
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  load().catch((e) => {
    root.replaceChildren(
      el(
        "main",
        { class: "shell" },
        el("h1", {}, "暂时未能打开学习空间"),
        el("p", {}, e.message),
        btn("重新连接", load, "primary"),
      ),
    );
  });
})();
