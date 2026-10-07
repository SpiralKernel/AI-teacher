"use strict";
const bankState = {
  subject: "math",
  stage: "junior",
  tag_id: "",
  difficulty: "",
  answer_mode: "",
  query: "",
  offset: 0,
  catalog: null,
  tags: [],
  results: { items: [], total: 0 },
  profile: null,
  attempt: null,
  result: null,
  choices: [],
  text: "",
  files: [],
  reviewDraft: null,
  messages: [],
  busy: false,
};
const bankVerdicts = {
  correct: "正确",
  incorrect: "错误",
  partial: "部分正确",
  uncertain: "无法判断",
};
function bankSubject() {
  return (
    bankState.catalog?.subjects.find((s) => s.id === bankState.subject)?.name ||
    "数学"
  );
}
function bankSelection() {
  return {
    subject: bankState.subject,
    stage: bankState.stage,
    tag_id: bankState.tag_id || null,
    difficulty: bankState.difficulty ? Number(bankState.difficulty) : null,
    answer_mode: bankState.answer_mode || null,
    allow_challenge: state.allowChallenge,
  };
}
async function loadBank() {
  const filters = new URLSearchParams({
    subject: bankState.subject,
    stage: bankState.stage,
    query: bankState.query,
    offset: bankState.offset,
  });
  for (const field of ["tag_id", "difficulty", "answer_mode"])
    if (bankState[field]) filters.set(field, bankState[field]);
  const [catalog, tags, results, profile] = await Promise.all([
    api("/bank/catalog"),
    api(
      "/bank/tags?" +
        new URLSearchParams({
          subject: bankState.subject,
          stage: bankState.stage,
          query: bankState.query,
        }),
    ),
    api("/bank/questions?" + filters),
    api(
      "/bank/profile?" +
        new URLSearchParams({
          subject: bankState.subject,
          stage: bankState.stage,
        }),
    ),
  ]);
  Object.assign(bankState, { catalog, tags: tags.items, results, profile });
}
async function bankRefresh() {
  try {
    await loadBank();
    render();
  } catch (e) {
    toast(e.message);
  }
}
async function bankStart(questionId, aiPlan = false) {
  if (bankState.busy) return;
  bankState.busy = true;
  try {
    const value = await api(aiPlan ? "/bank/plan" : "/bank/next", {
      ...bankSelection(),
      question_id: questionId || null,
    });
    const same = bankState.attempt?.attempt_id === value.attempt_id;
    bankState.attempt = value;
    bankState.result = null;
    if (!same) {
      bankState.choices = [];
      bankState.text = "";
      bankState.files = [];
      bankState.messages = [];
      bankState.reviewDraft = null;
    }
    if (value.review?.status === "review") bankReviewDraft(value.review);
    setView("bank");
    document
      .querySelector("#bank-workspace")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (e) {
    toast(e.message);
  } finally {
    bankState.busy = false;
    render();
  }
}
function bankReviewDraft(review) {
  if (bankState.reviewDraft?.review_id !== review.id)
    bankState.reviewDraft = {
      review_id: review.id,
      transcribed_answer: review.assessment.transcribed_answer,
      verdict: "",
      reviewed: false,
      count_evidence: true,
    };
}
function bankFilter(label, field, options) {
  const input = el(
    "select",
    {
      "aria-label": label,
      onChange: async (e) => {
        bankState[field] = e.target.value;
        bankState.offset = 0;
        if (field === "subject") {
          bankState.tag_id = "";
          bankState.query = "";
        }
        await bankRefresh();
      },
    },
    options.map(([value, text]) => el("option", { value }, text)),
  );
  input.value = bankState[field];
  return el("label", { class: "bank-filter" }, el("span", {}, label), input);
}
function bankView() {
  if (!bankState.catalog)
    return el("div", { class: "empty" }, "正在加载全科题库…");
  const profile = bankState.profile;
  const subjectCounts = bankState.catalog.counts.filter(
    (r) => r.subject === bankState.subject && r.stage === bankState.stage,
  );
  const count = subjectCounts.reduce((n, r) => n + r.count, 0),
    playable = subjectCounts.reduce((n, r) => n + (r.playable || 0), 0);
  const searchInput = el("input", {
    type: "search",
    placeholder: "搜索知识点、题型或题目关键词",
    "aria-label": "搜索全科题库",
    value: bankState.query,
    onInput: (e) => {
      bankState.query = e.target.value;
    },
  });
  const filters = el(
    "section",
    { class: "panel bank-filters" },
    el(
      "div",
      { class: "bank-filter-grid" },
      bankFilter(
        "科目",
        "subject",
        bankState.catalog.subjects.map((s) => [s.id, s.name]),
      ),
      bankFilter("作答方式", "answer_mode", [
        ["", "全部题型"],
        ["choice", "选择题"],
        ["written", "文字 / 拍照作答"],
      ]),
      bankFilter("难度", "difficulty", [
        ["", "全部难度"],
        ["1", "基础"],
        ["2", "一般"],
        ["3", "较难 / 挑战"],
      ]),
      bankFilter("知识点与细分题型", "tag_id", [
        ["", "智能选择"],
        ...bankState.tags.map((t) => [
          t.id,
          `${t.kind === "type" ? "题型" : "知识"} · ${t.label} (${t.question_count})`,
        ]),
      ]),
    ),
    el(
      "form",
      {
        class: "bank-search",
        onSubmit: async (e) => {
          e.preventDefault();
          bankState.offset = 0;
          bankState.tag_id = "";
          await bankRefresh();
        },
      },
      searchInput,
      el("button", { class: "btn light", type: "submit" }, "搜索"),
    ),
    el(
      "div",
      { class: "actions" },
      button("按标签智能练习  →", () => bankStart()),
      button("让 AI 按标签选题", () => bankStart(null, true), "light"),
      el(
        "span",
        { class: "note" },
        `${bankSubject()} · ${count.toLocaleString()} 道材料 · ${playable.toLocaleString()} 道可作答`,
      ),
    ),
    el(
      "p",
      { class: "note" },
      "当前为初中全学段。先选择科目和知识点；没有标注年级的题暂不限定为七上。",
    ),
  );
  return el(
    "div",
    {},
    heading(
      "把每一科，都学明白。",
      "按知识点找题，按题型看进步。阅读可以慢慢读，大题可以写在纸上。",
      "初中 · 全科",
    ),
    filters,
    bankState.attempt ? bankWorkspace() : null,
    bankProfilePanel(profile),
    el(
      "div",
      { class: "section-title" },
      el("h2", {}, "题库浏览"),
      el("small", {}, `找到 ${bankState.results.total.toLocaleString()} 道`),
    ),
    bankState.results.items.length
      ? el(
          "div",
          { class: "bank-list" },
          bankState.results.items.map((q) =>
            el(
              "article",
              { class: "panel bank-card" },
              el(
                "div",
                { class: "question-meta" },
                el(
                  "span",
                  { class: "tag" },
                  q.answer_mode === "choice" ? "选择题" : "文字 / 拍照题",
                ),
                el(
                  "span",
                  {},
                  { 1: "基础", 2: "一般", 3: "挑战" }[q.difficulty],
                ),
              ),
              el("div", { class: "bank-excerpt math-copy" }, q.stem),
              el(
                "div",
                { class: "bank-tags" },
                (q.tags || [])
                  .filter((t) => t.kind === "knowledge")
                  .slice(0, 3)
                  .map((t) => el("span", { class: "tag" }, t.label)),
              ),
              q.can_practice
                ? button("开始作答", () => bankStart(q.id), "light")
                : el(
                    "p",
                    { class: "note" },
                    "这道题尚缺必要图形或材料，补齐后可练习。",
                  ),
            ),
          ),
        )
      : el(
          "div",
          { class: "empty" },
          "当前筛选没有题目，试试其它关键词或题型。",
        ),
    el(
      "div",
      { class: "actions" },
      bankState.offset
        ? button(
            "上一页",
            async () => {
              bankState.offset = Math.max(0, bankState.offset - 20);
              await bankRefresh();
            },
            "ghost",
          )
        : null,
      bankState.offset + 20 < bankState.results.total
        ? button(
            "下一页",
            async () => {
              bankState.offset += 20;
              await bankRefresh();
            },
            "light",
          )
        : null,
    ),
    el(
      "details",
      { class: "bank-sources" },
      el("summary", {}, "题库来源与使用说明"),
      bankState.catalog.sources.map((s) =>
        el(
          "p",
          {},
          el(
            "a",
            {
              href: s.manifest.url,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            s.id,
          ),
          ` · ${s.manifest.license}`,
        ),
      ),
      el(
        "p",
        { class: "note" },
        "来源标签保留；补充标签会标明来源。标准答案来自公开题集，尚未逐题教师审定。",
      ),
    ),
  );
}
function bankWorkspace() {
  const a = bankState.attempt,
    q = a.question,
    long = q.stem.length > 900 || ["chinese", "english"].includes(q.subject);
  const material = el(
    "section",
    { class: "panel bank-reading" },
    el("h2", {}, long ? "阅读材料与问题" : "题目与条件"),
    el(
      "div",
      { class: "question-meta" },
      el(
        "span",
        { class: "tag" },
        bankState.catalog.subjects.find((s) => s.id === q.subject)?.name ||
          q.subject,
      ),
      el(
        "span",
        {},
        q.answer_mode === "choice" ? "选择作答" : "文字 / 拍照作答",
      ),
    ),
    el("div", { class: "bank-stem math-copy" }, q.stem),
    el(
      "div",
      { class: "bank-tags" },
      (q.tags || []).map((t) => el("span", { class: "tag" }, t.label)),
    ),
    el(
      "p",
      { class: "note" },
      "来源：" + q.provenance.dataset + " · 原有标签已保留",
    ),
  );
  const answer = el(
    "section",
    { class: "panel bank-response" },
    el("h2", {}, "写下你的思考"),
    bankState.result
      ? bankResultPanel()
      : q.answer_mode === "choice"
        ? bankChoiceForm(q)
        : bankWrittenForm(),
    bankState.attempt.review?.status === "review" && !bankState.result
      ? bankReviewPanel(bankState.attempt.review)
      : null,
  );
  return el(
    "section",
    { id: "bank-workspace", class: "bank-workspace" },
    a.recommendation
      ? el("p", { class: "assessment" }, a.recommendation.reason)
      : null,
    el(
      "div",
      { class: "section-title" },
      el(
        "h2",
        {},
        long ? "留一点时间，把材料读完整。" : "一道题，一步步想清楚。",
      ),
      button(
        "收起作答",
        () => {
          bankState.attempt = null;
          render();
        },
        "ghost",
      ),
    ),
    el(
      "div",
      { class: "bank-study-layout " + (long ? "reading-layout" : "") },
      material,
      answer,
    ),
    bankTutorPanel(),
  );
}
function bankChoiceForm(q) {
  const choices = el(
    "div",
    { class: "bank-options" },
    q.options.map((option) =>
      el(
        "label",
        { class: "bank-option" },
        el("input", {
          type: q.kind === "multiple_choice" ? "checkbox" : "radio",
          name: "bank-choice",
          value: option.key,
          checked: bankState.choices.includes(option.key),
          onChange: (e) => {
            bankState.choices =
              q.kind === "multiple_choice"
                ? e.target.checked
                  ? [...bankState.choices, option.key]
                  : bankState.choices.filter((k) => k !== option.key)
                : [option.key];
          },
        }),
        el("strong", {}, option.key),
        el("span", { class: "math-copy" }, option.text),
      ),
    ),
  );
  return el(
    "form",
    {
      onSubmit: async (e) => {
        e.preventDefault();
        if (bankState.busy) return;
        if (!bankState.choices.length) {
          toast("请先选择答案");
          return;
        }
        bankState.busy = true;
        try {
          bankState.result = await api(
            `/bank/attempts/${bankState.attempt.attempt_id}/answer`,
            { answer: bankState.choices.join("") },
          );
          await loadBank();
        } catch (error) {
          toast(error.message);
        } finally {
          bankState.busy = false;
          render();
        }
      },
    },
    el(
      "p",
      { class: "note" },
      q.kind === "multiple_choice"
        ? "这是多选题，请选出所有符合条件的选项。"
        : "选择最符合题意的一项。",
    ),
    choices,
    el(
      "button",
      { type: "submit", class: "btn", disabled: bankState.busy },
      "提交答案",
    ),
  );
}
function bankWrittenForm() {
  const textarea = el("textarea", {
    "aria-label": "大题或阅读题解答",
    rows: 12,
    maxlength: 12000,
    placeholder:
      "按（1）（2）分题写下解答。也可以在纸上写完整步骤，再上传照片。",
    onInput: (e) => {
      bankState.text = e.target.value;
    },
  });
  textarea.value = bankState.text;
  const files = el("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp",
    multiple: true,
    "aria-label": "上传手写答案图片",
    onChange: (e) => {
      bankState.files = Array.from(e.target.files || []);
      fileLabel.textContent =
        bankState.files.map((f) => f.name).join("、") || "尚未选择图片";
    },
  });
  const camera = el("input", {
    type: "file",
    accept: "image/*",
    capture: "environment",
    "aria-label": "拍摄手写解答",
    onChange: (e) => {
      bankState.files = Array.from(e.target.files || []);
      fileLabel.textContent = bankState.files.map((f) => f.name).join("、");
    },
  });
  const fileLabel = el(
    "p",
    { class: "note" },
    bankState.files.map((f) => f.name).join("、") ||
      "每题最多4张图片，单张20MB，总计40MB。",
  );
  return el(
    "form",
    { class: "bank-written", onSubmit: bankAssess },
    textarea,
    el("label", { class: "bank-upload" }, "上传纸上解答", files),
    el("label", { class: "bank-upload" }, "手机拍照", camera),
    fileLabel,
    el(
      "p",
      { class: "note" },
      "点击后会将本题、文字解答和所选照片发送至 AI 评阅。结果核对后才计入档案。",
    ),
    el(
      "button",
      { class: "btn", type: "submit", disabled: bankState.busy },
      bankState.busy ? "AI 正在检查过程…" : "请 AI 检查解答",
    ),
  );
}
async function bankAssess(event) {
  event.preventDefault();
  if (bankState.busy) return;
  if (!bankState.text.trim() && !bankState.files.length) {
    toast("请填写解答或上传照片");
    return;
  }
  if (bankState.files.length > 4) {
    toast("每题最多上传4张图片");
    return;
  }
  const attemptId = bankState.attempt.attempt_id,
    form = new FormData();
  form.append("answer", bankState.text);
  bankState.files.forEach((file) => form.append("files", file));
  bankState.busy = true;
  render();
  try {
    const response = await fetch(`/api/v1/bank/attempts/${attemptId}/assess`, {
      method: "POST",
      body: form,
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value.detail === "string"
          ? value.detail
          : "评阅未完成，请重试。",
      );
    if (bankState.attempt?.attempt_id === attemptId) {
      bankState.attempt.review = value;
      bankReviewDraft(value);
    }
  } catch (e) {
    toast(e.message);
  } finally {
    bankState.busy = false;
    render();
  }
}
function bankReviewPanel(review) {
  bankReviewDraft(review);
  const a = review.assessment,
    draft = bankState.reviewDraft;
  const text = el("textarea", {
    "aria-label": "核对AI转写的解答",
    rows: 8,
    onInput: (e) => {
      draft.transcribed_answer = e.target.value;
      draft.reviewed = false;
      check.checked = false;
    },
  });
  text.value = draft.transcribed_answer;
  const select = el(
    "select",
    {
      "aria-label": "主观题核对结论",
      onChange: (e) => {
        draft.verdict = e.target.value;
        draft.reviewed = false;
        check.checked = false;
      },
    },
    el("option", { value: "" }, "请选择核对结论"),
    Object.entries(bankVerdicts).map(([id, label]) =>
      el("option", { value: id }, label),
    ),
  );
  select.value = draft.verdict;
  const check = el("input", {
    type: "checkbox",
    checked: draft.reviewed,
    onChange: (e) => {
      draft.reviewed = e.target.checked;
    },
  });
  return el(
    "div",
    { class: "bank-review" },
    el("h3", {}, "核对 AI 的评阅建议"),
    el(
      "p",
      { class: "assessment" },
      `建议：${bankVerdicts[a.verdict]} · ${a.confidence === "high" ? "识别较清楚" : "请仔细核对"}`,
    ),
    el("p", { class: "math-copy" }, a.reason),
    el(
      "ol",
      {},
      a.steps_feedback.map((s) => el("li", { class: "math-copy" }, s)),
    ),
    a.gaps.length
      ? el("div", { class: "hint-box" }, "值得再练：" + a.gaps.join("；"))
      : null,
    review.files.length
      ? el(
          "div",
          { class: "bank-answer-images" },
          review.files.map((name) =>
            el(
              "a",
              {
                href: `/api/v1/bank/attempts/${bankState.attempt.attempt_id}/pages/${name}`,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              el("img", {
                src: `/api/v1/bank/attempts/${bankState.attempt.attempt_id}/pages/${name}`,
                alt: "本题的手写解答",
              }),
            ),
          ),
        )
      : null,
    el("label", {}, "核对转写，纠正看错的字或步骤", text),
    el("label", {}, "你的核对结论", select),
    el("label", { class: "evidence-choice" }, check, "我已对照自己的解答核对"),
    el(
      "p",
      { class: "note" },
      "部分正确和无法判断保留反馈，不记为掌握证据。明确对错的主观题以较低权重计入。",
    ),
    button("确认评阅并保存", async () => {
      if (!draft.reviewed || !draft.verdict) {
        toast("请核对转写、选择结论并勾选已核对");
        return;
      }
      try {
        bankState.result = await api(
          `/bank/attempts/${bankState.attempt.attempt_id}/confirm`,
          draft,
        );
        await loadBank();
        render();
      } catch (e) {
        toast(e.message);
      }
    }),
  );
}
function bankResultPanel() {
  const r = bankState.result;
  return el(
    "div",
    { class: "result " + (r.correct ? "" : "wrong") },
    el("h3", {}, `已保存：${bankVerdicts[r.verdict]}`),
    el("p", { class: "math-copy bank-reference" }, "参考答案：" + r.answer),
    el(
      "ol",
      {},
      r.steps.map((s) => el("li", { class: "math-copy" }, s)),
    ),
    el(
      "p",
      { class: "note" },
      r.evidence_weight
        ? "本次作答已计入对应知识点与细分题型画像。"
        : "记录已保存，本次没有增加掌握证据。",
    ),
    button("再练一道", () => bankStart()),
    button(
      "查看本科学习画像",
      () =>
        document
          .querySelector("#bank-profile")
          ?.scrollIntoView({ behavior: "smooth" }),
      "ghost",
    ),
  );
}
function bankProfilePanel(profile) {
  return el(
    "section",
    { id: "bank-profile", class: "bank-profile" },
    el(
      "div",
      { class: "section-title" },
      el("h2", {}, `${bankSubject()} · 知识点与题型画像`),
      el("small", {}, `已作答 ${profile.completed} 题`),
    ),
    profile.tags.length
      ? el(
          "div",
          { class: "type-grid" },
          profile.tags.slice(0, 18).map((t) =>
            el(
              "article",
              { class: "type-card" },
              el(
                "strong",
                {},
                `${t.kind === "type" ? "题型" : "知识点"} · ${t.label}`,
              ),
              el("span", { class: "tag" }, t.status),
              el(
                "p",
                {},
                `${t.attempts}次有效作答 · ${t.correct}次正确 · ${t.mastery === null ? "待诊断" : "掌握估计" + Math.round(t.mastery * 100) + "%"}`,
              ),
              button(
                "针对这个标签练习",
                async () => {
                  bankState.tag_id = t.id;
                  await bankRefresh();
                  await bankStart();
                },
                "light",
              ),
            ),
          ),
        )
      : el(
          "p",
          { class: "assessment" },
          "做过题后，这里会按具体知识点和题型留下证据。",
        ),
    el("p", { class: "note" }, profile.note),
    profile.history.length
      ? el(
          "details",
          {},
          el("summary", {}, "最近的全科作答"),
          profile.history.slice(0, 10).map((h) =>
            el(
              "details",
              { class: "bank-history" },
              el(
                "summary",
                {},
                `${bankVerdicts[h.result.verdict]} · ${h.question.stem.slice(0, 80)}`,
              ),
              el("p", { class: "bank-stem math-copy" }, h.answer),
              el("p", { class: "math-copy" }, "参考答案：" + h.result.answer),
              el(
                "div",
                {},
                h.result.steps.map((s) => el("p", { class: "math-copy" }, s)),
              ),
            ),
          ),
        )
      : null,
  );
}
function bankTutorPanel() {
  const text = el("textarea", {
    "aria-label": "向全科学习伙伴提问",
    rows: 2,
    maxlength: 1600,
    placeholder: "说说你卡在哪个条件、哪一步或哪一小题。",
  });
  return el(
    "section",
    { class: "panel bank-tutor" },
    el("h2", {}, "一起想一想"),
    el(
      "div",
      { class: "chat" },
      bankState.messages.map((m) =>
        el(
          "div",
          { class: "bubble " + (m.role === "user" ? "user" : "") },
          m.text,
        ),
      ),
    ),
    el(
      "form",
      {
        onSubmit: async (e) => {
          e.preventDefault();
          const message = text.value.trim();
          if (!message || bankState.busy) return;
          const id = bankState.attempt.attempt_id;
          bankState.busy = true;
          bankState.messages.push({ role: "user", text: message });
          render();
          try {
            const r = await api(`/bank/attempts/${id}/tutor`, { message });
            if (bankState.attempt?.attempt_id === id)
              bankState.messages.push({
                role: "assistant",
                text: r.reply + "\n" + r.check_question,
              });
          } catch (e) {
            toast(e.message);
          } finally {
            bankState.busy = false;
            render();
          }
        },
      },
      text,
      el(
        "button",
        { class: "btn light", type: "submit", disabled: bankState.busy },
        bankState.busy ? "正在思考…" : "讨论这一题",
      ),
    ),
  );
}
