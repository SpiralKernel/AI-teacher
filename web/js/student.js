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
    training: null,
    result: null,
    unit: "",
    written: false,
    choice: false,
    challenge: true,
    aiType: "",
    messages: [],
    draft: "",
    files: [],
    answer: "",
    partAnswers: {},
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
      training: null,
      result: null,
      messages: [],
      files: [],
      draft: "",
      answer: "",
      partAnswers: {},
      choices: [],
      review: null,
      aiType: "",
      mode: "ai",
      unit: "",
      written: false,
      choice: false,
    });
    notice.hidden = true;
  }
  async function load() {
    const session = await api("/auth/session");
    S.student = session.student;
    S.availableBooks = session.available_books || [];
    S.registrationEnabled = session.registration_enabled !== false;
    S.inviteRequired = session.registration_requires_invite === true;
    S.authMode = session.needs_setup && S.registrationEnabled ? "register" : "login";
    S.needsSetup = session.needs_setup;
    if (S.student) {
      S.home = await api("/study/home");
      S.training = (await api("/study/training-plans")).plan;
    }
    render();
  }
  function stageFields(grade = 7, term = 1, subject = "math", level = "junior", bookId = "") {
    grade = grade || 7; term = term || 1;
    const remembered = { [subject]: {grade, term} };
    const rememberedBooks = { [subject]: bookId };
    let current = subject;
    const g = select("年级", [], grade, () => {});
    const t = select("学期", [], term, () => {});
    const book = select("高中教材册次", [], bookId, () => {});
    const juniorFields = el("div", {class:"split-fields"}, field("学习年级",g), field("册次 / 进度",t));
    const seniorFields = field("教材册次",book);
    const levelSelect = select("学段", [["junior","初中"],["senior","高中"]], level, () => refill());
    const refill = () => {
      juniorFields.hidden = levelSelect.value !== "junior";
      seniorFields.hidden = levelSelect.value !== "senior";
      const books = (S.availableBooks || []).filter(b => b.subject === current);
      book.replaceChildren(...books.map(b => el("option", {value:b.id}, b.title)));
      if (books.some(b => b.id === rememberedBooks[current])) book.value = rememberedBooks[current];
      const saved = remembered[current] || {grade: current === "physics" ? 8 : 7, term: 1};
      g.replaceChildren(...(current === "physics" ? [[8,"八年级"],[9,"九年级"]] : [[7,"七年级"],[8,"八年级"],[9,"九年级"]]).map(([v,n]) => el("option", {value:v}, n)));
      g.value = saved.grade;
      const terms = () => {
        const all = current === "physics" && Number(g.value) === 9;
        t.replaceChildren(el("option", {value:1}, all ? "全一册 · 前半进度" : "上册"), el("option", {value:2}, all ? "全一册 · 后半进度" : "下册"));
        t.value = saved.term;
      };
      g.onchange = terms; terms();
    };
    const sub = select("科目", [["math","数学"],["physics","物理"]], current, () => {
      remembered[current] = {grade:Number(g.value),term:Number(t.value)};
      rememberedBooks[current] = book.value;
      current = sub.value; refill();
    });
    refill();
    return {
      node: el("div", {}, field("学段",levelSelect), field("科目", sub), juniorFields, seniorFields),
      get: () => levelSelect.value === "senior"
        ? {subject:current,stage:"senior",book_id:book.value}
        : {subject:current,stage:"junior",grade:Number(g.value),term:Number(t.value)},
    };
  }
  function subjectName() { return S.student?.subject === "physics" ? "物理" : "数学"; }
  function stageName() {
    if (S.student.stage === "senior") return S.student.book_title || "高中";
    if (S.student.subject === "physics" && S.student.grade === 9) return `九年级全一册 · ${S.student.term === 1 ? "前半" : "后半"}进度`;
    return `${S.student.grade}年级${S.student.term === 1 ? "上" : "下"}册`;
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
    const invite = el("input", {type: "text", required: S.inviteRequired, maxlength: 128, autocomplete: "off", placeholder: "输入一次性邀请码"});
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
                invitation_code: invite.value.trim(),
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
      register && S.inviteRequired ? field("邀请码（仅可使用一次）", invite) : null,
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
            ? "选好科目和学习阶段，从基础诊断开始。"
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
          S.registrationEnabled ? btn(
            "新建学生",
            () => {
              S.authMode = "register";
              render();
            },
            register ? "badge" : "quiet",
          ) : null,
        ),
        form,
      ),
    );
  }
  async function refresh() {
    S.home = await api("/study/home");
    if (S.training) S.training = await api(`/study/training-plans/${S.training.id}`);
  }
  async function continueTraining() {
    const value = await api(`/study/training-plans/${S.training.id}/next`, {});
    Object.assign(S, {training:value.plan, work:value.work, mode:"bank", result:null,
      answer:"", partAnswers:{}, choices:[], files:[], review:null});
    await refresh(); render();
    document.querySelector("#work")?.scrollIntoView({block:"start",behavior:"smooth"});
  }
  function trainingCard() {
    const p = S.training;
    return el("section", {class:"card training-card"},
      el("h2", {}, p ? (p.mode === "training" ? "针对加练与独立复测" : "独立诊断 / 复习") : "下一步，练什么？"),
      p ? el("p", {}, `${p.name} · 难度 ${p.difficulty} · ${p.answered} / ${p.total} 题`) : null,
      el("p", {class:"subtle"}, p ? p.reason : "根据独立答题证据安排练习；证据不足时，先做几道核验新题。"),
      p?.ai_reason ? el("p", {class:"tiny"}, `AI计划建议：${p.ai_reason}`) : null,
      p ? el("p", {class:"tiny"}, p.note) : null,
      p?.status === "completed" ? el("p", {}, `本轮已完成。独立复测 / 诊断 ${p.retest_correct} / ${p.retest_answered} 题答对，其中 ${p.independent_retests} 题计入有效独立证据。请结合下方题型状态查看，不以一轮成绩宣布掌握。`) : null,
      el("div", {class:"actions"},
        !p || p.status !== "active" ? btn("安排下一轮", async()=>{
          S.training = await api("/study/training-plans", {}); render();
        }, "primary") : btn(p.answered ? "恢复本轮练习" : `开始${p.training_count ? ` ${p.training_count} 道加练 + ${p.retest_count} 道复测` : ` ${p.retest_count} 道独立新题`}`, continueTraining, "primary"),
        p?.status === "active" ? btn("结束本轮", async()=>{
          await api(`/study/training-plans/${p.id}/cancel`, {});
          if (S.work?.training_plan_id === p.id) {S.work=null; S.result=null;}
          S.training=null; await refresh(); render();
        }, "quiet") : null));
  }
  async function start(typeId = null) {
    const w = await api("/study/next", {
      unit_id: typeId ? null : S.unit || null,
      type_id: typeId,
      written: typeId ? false : S.written,
      choice: typeId ? false : S.choice,
      allow_challenge: S.challenge,
    });
    Object.assign(S, {
      mode: "bank",
      work: w,
      result: null,
      answer: "",
      partAnswers: {},
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
    const stage = stageFields(S.student.grade, S.student.term, S.student.subject || "math", S.student.stage || "junior", S.student.book_id || "");
    const shade = el("div", { class: "dialog-shade" });
    const updateInfo = el("p", {class:"subtle"}, "联网检查题库版本；更新会保留已有学习记录。");
    const updateActions = el("div", {class:"actions"});
    const updateButton = btn("检查题库更新", async () => {
      const value = await api('/content/check');
      updateInfo.textContent = value.message;
      updateActions.replaceChildren();
      if (value.available) updateActions.append(btn("下载并更新题库", async () => {
        updateInfo.textContent = '正在下载并校验更新包…';
        try {
          const result = await api('/content/update', {});
          await refresh();
          updateInfo.textContent = result.updated ? `已更新到版本 ${result.version}，学习记录保留。` : '题库已是最新版本。';
          updateActions.replaceChildren();
        } catch (e) {
          updateInfo.textContent = '更新未完成，原题库和学习记录保留。';
          throw e;
        }
      }, "primary"));
    }, "quiet");
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
        el("p", { class: "subtle" }, `${S.student.nickname} · ${subjectName()}`),
        stage.node,
        el(
          "p",
          { class: "subtle" },
            "只显示所选科目与教材范围。高中按册次学习；切换会保留学习记录。",
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
        el("section", {class:"content-update"}, el("h3", {}, "题库更新"), updateInfo, updateButton, updateActions),
        S.student.is_admin ? el("p", {}, el("a", {href:"/admin"}, "打开题库工作台 →")) : null,
      ),
    );
    root.append(shade);
    shade.querySelector("select").focus();
  }
  function bankPage() {
    const home = S.home;
    const chapter = select(
      "练习章节",
      [["", "本册全部章节"], ...home.book.units.map((u) => [u.id, u.name])],
      S.unit,
      (v) => (S.unit = v),
    );
    const format = select(
      "作答方式",
      [
        ["numeric", home.book.id === "math-7-1" ? "短答练习" : "核心诊断练习"],
        ["written", "文字 / 拍照题"],
        ["choice", "选择题"],
      ],
      S.written ? "written" : S.choice ? "choice" : "numeric",
      (v) => {
        S.written = v === "written";
        S.choice = v === "choice";
      },
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
            ? "短答题的答案已检查，独立完成后会更新题型状态。选择题和文字 / 拍照题保留练习记录，来源答案仍需核对。"
            : "规则核心题可记录独立证据；精选来源题和文字 / 拍照题用于学习反馈。题量不足时保留“未评估”，不会据此宣布掌握。",
        ),
      ),
      trainingCard(),
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
      el("div", { class: "question-stem" }, q.diagram?.kind === "square_grid" ? q.stem.split("图形位置：")[0] : q.stem),
    );
    if (w.training_plan_id) node.prepend(el("p", {class:"training-phase"},
      `第 ${w.position} 题 · ${w.training_phase === "training" ? "加练：可以提问，本题不增加掌握证据" : "独立新题：请先独立作答；求助后本题不计独立证据"}`));
    const formats = {single_choice:"单项选择",multiple_choice:"多项选择",fill_blank:"填空",calculation:"计算",proof:"证明",application:"应用",composite:"综合解答",short_answer:"解答"};
    if (q.annotation) node.append(el("p", {class:"tiny"}, formats[q.annotation.response_format] || "解答"));
    if (q.diagram?.kind === "square_grid") {
      const cells = q.diagram.cells;
      const size = 48;
      const width = (Math.max(...cells.map((c) => c.x)) + 1) * size + 8;
      const height = (Math.max(...cells.map((c) => c.y)) + 1) * size + 8;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "正方体展开图，面的位置也列在题干中");
      svg.classList.add("question-diagram");
      for (const cell of cells) {
        const rect = document.createElementNS(svg.namespaceURI, "rect");
        for (const [key, value] of Object.entries({ x: cell.x * size + 4, y: cell.y * size + 4, width: size, height: size, fill: "#F5E2DA", stroke: "#3B3838" }))
          rect.setAttribute(key, String(value));
        const label = document.createElementNS(svg.namespaceURI, "text");
        label.setAttribute("x", String(cell.x * size + size / 2 + 4));
        label.setAttribute("y", String(cell.y * size + size / 2 + 4));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");
        label.setAttribute("fill", "#3B3838");
        label.textContent = cell.label;
        svg.append(rect, label);
      }
      node.append(svg, el("p", { class: "tiny" }, q.diagram.caption));
      const positions = q.stem.split("图形位置：")[1];
      if (positions) node.append(el("details", { class: "tiny" }, el("summary", {}, "查看图形位置说明"), el("p", {}, positions)));
    }
    node.append(
      btn(
        "问问 AI",
        () => teacherUI.open({ source: w.source, attempt_id: w.attempt_id }),
        "ask-teacher-button",
      ),
    );
    if (S.result) {
      const r = S.result;
      const reference = q.answer_mode === "choice"
        ? (q.options || []).filter((o) => String(r.answer).includes(o.key))
            .map((o) => `${o.key}. ${o.text}`).join("；") || r.answer
        : r.answer;
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
          el("p", {}, `参考答案：${reference}`),
          gradingPanel(r.explanation),
          r.annotation?.parts?.length > 1 ? el("div", {class:"question-parts"}, r.annotation.parts.map((p,i)=>
            el("details", {}, el("summary", {}, `第 ${i+1} 问参考解答`), el("p", {}, p.reference_answer || "逐问答案待核对，请结合整题解析。"),
              el("ol", {}, (p.solution_steps || []).map(s=>el("li", {}, s)))))) : null,
          el(
            "ol",
            {},
            (r.steps || []).map((t) => el("li", {}, t)),
          ),
          r.error ? el("p", { class: "subtle" }, r.error.feedback) : null,
          el(
            "p",
            { class: "tiny" },
            w.training_plan_id ? (r.evidence_weight > 0 && !r.assisted ? "独立复测记录已保存，题型状态按已有规则更新。" : "学习记录已保存；加练、求助或重复作答不增加独立证据。") : w.source === "verified" && r.evidence_weight > 0 && !r.assisted
              ? "已保存独立作答记录。"
              : w.source === "bank"
                ? "已保存作答记录。来源答案或 AI 评阅经核验前，不计入可靠题量。"
                : "记录已保存；重复或辅助作答不增加独立题量。",
          ),
          el(
            "div",
            { class: "actions" },
            btn(w.training_plan_id ? (S.training?.status === "completed" ? "查看本轮结果" : "继续本轮") : "下一题", w.training_plan_id ? continueTraining : () => start(), "primary"),
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
    if (["numeric", "expression", "scientific", "decimal"].includes(q.answer_mode)) {
      const input = el("input", {
        "aria-label": "你的答案",
        value: S.answer,
        maxLength: 64,
        required: true,
        autocomplete: "off",
        placeholder: { expression: "填写代数式，例如 3x+2", scientific: "例如 3.2×10^5 或 3.2e5", decimal: "保留题目要求的小数位数" }[q.answer_mode] || "填写数值，例如 -3 或 1/2",
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
      const parts = q.annotation?.parts || [];
      const multipart = parts.length > 1;
      const fill = q.annotation?.response_format === "fill_blank";
      const input = el("textarea", {
        "aria-label": "完整解答",
        value: S.answer,
        maxLength: 12000,
        placeholder: fill ? "按空格顺序填写答案；有单位或精度要求时一并写明。" : multipart ? "补充整题说明，或上传包含全部小问的手写答案。" : "写下你的推理和步骤，或拍照上传手写答案。",
        onInput: (e) => (S.answer = e.target.value),
      });
      node.append(
        multipart ? el("div", {class:"question-parts"}, parts.map((p,i)=>el("section", {class:"question-part"},
          el("h3", {}, `第 ${i+1} 问`), el("p", {class:"part-prompt"}, p.prompt), field(`第 ${i+1} 问解答`, el("textarea", {
            "aria-label":`第 ${i+1} 问解答`, value:S.partAnswers[p.id] || "", maxLength:12000,
            placeholder:"写下本问的答案与过程，也可以统一拍照上传。", onInput:e=>S.partAnswers[p.id]=e.target.value,
          }))))) : null,
        field(multipart ? "补充说明（可选）" : fill ? "填写答案" : "你的解答", input),
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
            const answer = [multipart ? parts.filter(p=>S.partAnswers[p.id]?.trim()).map(p=>`${p.id}：${S.partAnswers[p.id]}`).join("\n\n") : "", S.answer].filter(Boolean).join("\n\n");
            if (answer.length > 12000) throw new Error("整题解答合计最多 12000 字，可以改用拍照上传。");
            form.append("answer", answer);
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
      gradingPanel(a),
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
  function gradingPanel(assessment) {
    const d = assessment?.grading_detail;
    if (!d) return null;
    const verdicts = {correct:"正确",incorrect:"需要修改",partial:"部分正确",uncertain:"待确认",met:"已呈现",not_met:"需要补充"};
    const partName = id => {const i=(S.work?.question.annotation?.parts || []).findIndex(p=>p.id===id);return i>=0?`第 ${i+1} 问`:"本问";};
    return el("div", {class:"grading-detail"},
      el("h3", {}, "逐问反馈"),
      d.part_feedback.map(f=>el("article", {}, el("strong", {}, `${partName(f.part_id)} · ${verdicts[f.verdict] || "待确认"}`),
        el("p", {}, f.reason), f.evidence_quote ? el("blockquote", {}, f.evidence_quote) : null)),
      d.criterion_feedback.length ? el("details", {}, el("summary", {}, "查看解题过程反馈"),
        d.criterion_feedback.map(f=>el("p", {}, `${partName(f.part_id)} · ${verdicts[f.verdict] || "待确认"}：${f.reason}`))) : null,
      el("p", {class:"tiny"}, d.score == null ? "当前提供文字反馈，分数待核对。" : `AI 建议得分：${d.score} / ${d.full_score}，请结合转写和过程核对。`));
  }
  function progress() {
    const groups = S.home.types;
    const policy = S.home.evaluation_policy || {};
    return el(
      "details",
      { class: "card progress" },
      el("summary", {}, "看看我的题型状态"),
      el(
        "p",
        { class: "subtle" },
        "每种题至少独立完成 5 道不同的有效练习，再结合最近表现判断。未评估不代表不会。",
      ),
      el("details", {class:"state-policy"}, el("summary", {}, "学情是怎么判断的？"),
        el("p", {}, `至少 ${policy.minimum_distinct || 5} 道不同的有效独立练习才判断题型表现；重点参考最近 ${policy.evidence_window || 8} 条，旧证据每 ${policy.half_life_days || 30} 天降低一半权重。`),
        el("p", {}, "问知识只记录兴趣，自述不会先待确认；具体错答经过复核后才记录困难。得到提示、照抄解答和 AI 评阅不增加独立掌握证据。"),
        el("p", {}, "长期未练会建议复测，历史记录仍保留。学情线索不准确时可以撤回。")),
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
                t.independent_count || t.learning_notes?.length ? el("details", {class:"type-evidence"},
                  el("summary", {}, "查看判断依据"),
                  el("p", {}, `近${t.evidence_summary?.half_life_days || 30}天 ${t.evidence_summary?.recent_independent_count || 0} 道有效独立练习；本次参考最近 ${t.evidence_summary?.sample_count || 0} 条。`),
                  (t.learning_notes || []).map(note=>el("div", {class:"learning-note"},
                    el("p", {}, note.note), el("blockquote", {}, note.evidence_quote),
                    btn("撤回这条学情线索", async()=>{
                      await api(`/teacher/observations/${note.id}/dismiss`, {});
                      await refresh();render();
                    }, "note-dismiss")))) : null,
              ),
              el(
                "span",
                { class: `badge ${t.status === "需要补强" ? "warn" : ""}` },
                t.current_status || t.learning_status || t.status,
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
          `${S.student.nickname} · ${stageName()} · ${subjectName()}`,
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
              : el("div", {}, trainingCard(), teacherUI.page()),
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
