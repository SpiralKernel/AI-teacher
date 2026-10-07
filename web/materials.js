"use strict";
const materialState = {
  list: [],
  current: null,
  files: [],
  mode: "completed",
  start: "1",
  end: "",
  uploading: false,
  confirming: false,
  activePage: 1,
  drafts: {},
  activeItem: null,
  messages: [],
  chatting: false,
  chatDraft: "",
  poll: null,
};
const statusNames = {
  uploaded: "等待识别",
  processing: "正在识别",
  review: "等待核对",
  confirmed: "已生成报告",
  failed: "识别未完成",
};
const verdictNames = {
  correct: "答对",
  incorrect: "答错",
  unanswered: "未作答",
  uncertain: "无法判断",
};

async function loadMaterials() {
  materialState.list = (await api("/imports")).items;
}
function renderMaterials() {
  if (state.view === "materials") render();
}
async function openMaterial(id) {
  try {
    const value = await api(`/imports/${id}`);
    materialState.current = value;
    materialState.activePage = 1;
    materialState.drafts = {};
    materialState.activeItem = null;
    materialState.messages = [];
    setView("materials");
    if (value.status === "processing") pollMaterial(id);
  } catch (e) {
    toast(e.message);
  }
}
function pollMaterial(id) {
  clearTimeout(materialState.poll);
  materialState.poll = setTimeout(async () => {
    try {
      const value = await api(`/imports/${id}`);
      if (materialState.current?.id !== id) return;
      materialState.current = value;
      if (value.status === "processing") pollMaterial(id);
      else {
        await loadMaterials();
        await refreshStudent();
        materialState.drafts = {};
      }
      renderMaterials();
    } catch (e) {
      toast(e.message);
    }
  }, 2000);
}
function materialView() {
  const upload = uploadPanel();
  const current = materialState.current;
  return el(
    "div",
    {},
    heading(
      "把纸上的题，带进学习空间。",
      "拍照提问，或从已作答试卷找到下一步。",
    ),
    upload,
    current ? materialDetail(current) : null,
    el(
      "div",
      { class: "section-title material-section" },
      el("h2", {}, "我的试卷与题目"),
      el("p", {}, "原页、核对结论和讨论会保留"),
    ),
    materialState.list.length
      ? el(
          "div",
          { class: "material-list" },
          materialState.list.map((m) =>
            el(
              "button",
              {
                class: "material-list-item",
                type: "button",
                onClick: () => openMaterial(m.id),
              },
              el("span", { class: "material-file-icon" }, "▧"),
              el(
                "span",
                { class: "material-list-name" },
                m.title,
                el(
                  "small",
                  {},
                  `${m.page_count} 页 · ${m.mode === "completed" ? "已作答材料" : "空白题目"} · ${new Date(m.created_at).toLocaleDateString("zh-CN")}`,
                ),
              ),
              el("span", { class: "tag" }, statusNames[m.status]),
            ),
          ),
        )
      : el(
          "p",
          { class: "note" },
          "还没有导入材料。可以先拍一道做过的题，体验识别与核对。",
        ),
  );
}
function chooseFiles(event) {
  materialState.files = Array.from(event.target.files || []);
  renderMaterials();
}
function uploadPanel() {
  const input = el("input", {
    type: "file",
    id: "material-files",
    accept: "image/jpeg,image/png,image/webp,image/gif,application/pdf",
    multiple: true,
    onChange: chooseFiles,
    "aria-label": "选择试卷图片或PDF",
    disabled: materialState.uploading,
  });
  const camera = el("input", {
    type: "file",
    id: "material-camera",
    accept: "image/*",
    capture: "environment",
    onChange: chooseFiles,
    "aria-label": "拍照上传题目",
    disabled: materialState.uploading,
  });
  const mode = el("select", {
    id: "material-mode",
    onChange: (e) => {
      materialState.mode = e.target.value;
    },
  });
  mode.append(
    el("option", { value: "completed" }, "已作答试卷 / 习题"),
    el("option", { value: "blank" }, "空白题目（仅提问与范围分析）"),
  );
  mode.value = materialState.mode;
  const start = el("input", {
    type: "number",
    min: 1,
    id: "page-start",
    value: materialState.start,
    onInput: (e) => {
      materialState.start = e.target.value;
    },
  });
  const end = el("input", {
    type: "number",
    min: 1,
    id: "page-end",
    value: materialState.end,
    placeholder: "全部",
    onInput: (e) => {
      materialState.end = e.target.value;
    },
  });
  const form = el(
    "form",
    { onSubmit: uploadMaterial },
    el(
      "div",
      { class: "upload-heading" },
      el(
        "div",
        {},
        el("h2", {}, "导入已作答材料"),
        el("p", {}, "先上传预览，再发送给 AI 识别。"),
      ),
      el("span", { class: "tag" }, "图片 / PDF"),
    ),
    el(
      "div",
      { class: "upload-picker" },
      el("span", { class: "upload-symbol", "aria-hidden": true }, "▧"),
      el("p", {}, "选择清晰的题目、试卷或习题册页面"),
      el(
        "div",
        { class: "file-buttons" },
        el("label", { class: "btn", for: "material-files" }, "选择文件  ↑"),
        el("label", { class: "btn ghost", for: "material-camera" }, "拍照"),
      ),
      input,
      camera,
      el(
        "small",
        {},
        materialState.files.length
          ? materialState.files.map((f) => f.name).join("、")
          : "每个文件 ≤20MB · 总计 ≤40MB · 每次最多 8 页",
      ),
    ),
    el(
      "div",
      { class: "upload-options" },
      el("div", {}, el("label", { for: "material-mode" }, "材料类型"), mode),
      el("div", {}, el("label", { for: "page-start" }, "PDF 起始页"), start),
      el("div", {}, el("label", { for: "page-end" }, "PDF 结束页"), end),
    ),
    el(
      "p",
      { class: "note" },
      "习题册请按页码分批导入。识别前请裁掉姓名、学校等信息；识别时页面内容会发送到 DeepSeek。",
    ),
    el(
      "button",
      {
        class: "btn light",
        type: "submit",
        disabled: materialState.uploading || !materialState.files.length,
      },
      materialState.uploading ? "正在处理页面…" : "上传并预览  →",
    ),
  );
  return el("section", { class: "panel upload-panel" }, form);
}
async function uploadMaterial(event) {
  event.preventDefault();
  if (materialState.uploading || !materialState.files.length) return;
  const form = new FormData();
  materialState.files.forEach((f) => form.append("files", f));
  form.append("mode", materialState.mode);
  form.append("page_start", materialState.start || "1");
  form.append("page_end", materialState.end || "0");
  materialState.uploading = true;
  renderMaterials();
  try {
    const response = await fetch("/api/v1/imports", {
      method: "POST",
      body: form,
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value.detail === "string"
          ? value.detail
          : "文件或页码格式不正确",
      );
    materialState.current = value;
    materialState.activePage = 1;
    materialState.drafts = {};
    materialState.activeItem = null;
    materialState.files = [];
    await loadMaterials();
  } catch (e) {
    toast(e.message || "上传失败，请检查连接");
  } finally {
    materialState.uploading = false;
    renderMaterials();
  }
}
function materialDetail(value) {
  const page =
    value.pages.find((p) => p.number === materialState.activePage) ||
    value.pages[0];
  const selector = el(
    "select",
    {
      "aria-label": "切换试卷页面",
      onChange: (e) => {
        materialState.activePage = Number(e.target.value);
        renderMaterials();
      },
    },
    value.pages.map((p) => el("option", { value: p.number }, p.label)),
  );
  selector.value = page.number;
  const preview = el(
    "section",
    { class: "panel paper-preview" },
    selector,
    el(
      "a",
      {
        href: page.url,
        target: "_blank",
        rel: "noopener",
        title: "打开原页放大查看",
      },
      el("img", { src: page.url, alt: page.label, loading: "lazy" }),
    ),
    el("p", { class: "note" }, "点击原页可放大查看。识别文字需要与原图核对。"),
  );
  let content;
  if (value.status === "uploaded" || value.status === "failed")
    content = el(
      "section",
      { class: "panel" },
      el(
        "h2",
        { class: "material-title" },
        value.status === "failed" ? "这次识别未完成" : "页面已保存，准备识别",
      ),
      el(
        "p",
        { class: "assessment" },
        value.error ||
          `将识别 ${value.page_count} 页，区分题干与学生作答，并给出待核对的评价。`,
      ),
      el("p", { class: "note" }, "点击后会将这些页面发送至 DeepSeek。"),
      el(
        "div",
        { class: "actions" },
        button(
          value.status === "failed" ? "重新识别" : "发送至 AI，开始识别",
          () => recognizeMaterial(value.id),
        ),
        button("删除这份材料", () => deleteMaterial(value.id), "ghost"),
      ),
    );
  else if (value.status === "processing")
    content = el(
      "section",
      { class: "panel" },
      el("div", { class: "recognition-indicator" }, "✦"),
      el("h2", { class: "material-title" }, "正在识别题目与作答…"),
      el(
        "p",
        { class: "assessment" },
        `${value.page_count} 页将逐页处理，页面会自动更新。可以切换到其他学习内容；请保持服务运行。`,
      ),
      el("p", { class: "note" }, "识别结果尚未计入学习档案。"),
    );
  else
    content = el(
      "div",
      {},
      value.status === "confirmed"
        ? reportPanel(value)
        : el(
            "div",
            { class: "review-intro" },
            el("h2", {}, "先核对，再了解自己。"),
            el(
              "p",
              {},
              "AI 的答案和对错判断都是建议。逐题确认题干、学生答案及知识点后，再选择是否计入档案。",
            ),
          ),
      value.items.map((item, index) => reviewItem(value, item, index)),
      value.status === "review"
        ? el(
            "section",
            { class: "panel confirmation-panel" },
            el(
              "p",
              { class: "assessment" },
              "不确定题可以保留为“无法判断”。只有明确勾选计入档案的对错结论才更新掌握证据；权重低于题库练习。",
            ),
            el("p", {
              class: "inline-error",
              id: "confirmation-error",
              role: "alert",
            }),
            button(
              materialState.confirming ? "正在保存…" : "确认评价并生成报告  →",
              () => confirmMaterial(value.id),
            ),
          )
        : null,
      materialState.activeItem ? materialChatPanel(value) : null,
    );
  return el(
    "div",
    { class: "material-section" },
    el(
      "div",
      { class: "section-title" },
      el("h2", {}, value.title),
      el("span", { class: "tag" }, statusNames[value.status]),
    ),
    el(
      "div",
      { class: "material-layout" },
      preview,
      el("div", { class: "material-content" }, content),
    ),
  );
}
function draftFor(item, mode) {
  if (!materialState.drafts[item.id])
    materialState.drafts[item.id] = {
      id: item.id,
      stem: item.stem,
      diagram_description: item.diagram_description,
      student_answer: item.student_answer,
      reference_answer: item.reference_answer,
      knowledge_ids: [...item.knowledge_ids],
      question_type_id: item.question_type_id || null,
      verdict: mode === "blank" ? "unanswered" : "",
      reviewed: false,
      count_evidence: false,
      assisted: !!item.assisted,
    };
  return materialState.drafts[item.id];
}
function reviewItem(value, item, index) {
  const fixed = value.status === "confirmed",
    draft = fixed ? item : draftFor(item, value.mode),
    prefix = "import-" + item.id;
  let reviewed;
  function edited() {
    if (!fixed) {
      draft.reviewed = false;
      if (reviewed) reviewed.checked = false;
    }
  }
  function textField(label, key, rows = 2) {
    const input = el("textarea", {
      id: prefix + "-" + key,
      rows,
      readonly: fixed,
      maxlength:
        key === "stem" ? 5000 : key === "diagram_description" ? 1500 : 3000,
      onInput: (e) => {
        draft[key] = e.target.value;
        edited();
      },
    });
    input.value = draft[key];
    return el(
      "div",
      { class: "review-field" },
      el("label", { for: prefix + "-" + key }, label),
      input,
    );
  }
  const knowledgeChecks = el(
    "details",
    { class: "knowledge-select" },
    el(
      "summary",
      {},
      "考察知识点：" +
        (draft.knowledge_ids.map((k) => knowledge(k).name).join("、") ||
          "待匹配 / 超出范围"),
    ),
    el(
      "div",
      { class: "knowledge-options" },
      state.curriculum.knowledge.map((k) =>
        el(
          "label",
          {},
          el("input", {
            type: "checkbox",
            value: k.id,
            checked: draft.knowledge_ids.includes(k.id),
            disabled: fixed,
            onChange: (e) => {
              if (e.target.checked && draft.knowledge_ids.length >= 3) {
                e.target.checked = false;
                toast("每题最多选择 3 个知识点");
                return;
              }
              draft.knowledge_ids = e.target.checked
                ? [...draft.knowledge_ids, k.id]
                : draft.knowledge_ids.filter((id) => id !== k.id);
              edited();
              knowledgeChecks.querySelector("summary").textContent =
                "考察知识点：" +
                (draft.knowledge_ids
                  .map((id) => knowledge(id).name)
                  .join("、") || "待匹配 / 超出范围");
            },
          }),
          k.name,
        ),
      ),
    ),
  );
  const typeSelect = el(
    "select",
    {
      id: prefix + "-type",
      disabled: fixed,
      onChange: (e) => {
        draft.question_type_id = e.target.value || null;
        edited();
      },
    },
    el("option", { value: "" }, "未分类"),
    (state.student.question_types || []).map((t) =>
      el("option", { value: t.id }, t.name),
    ),
  );
  if (
    draft.question_type_id &&
    !Array.from(typeSelect.options).some(
      (o) => o.value === draft.question_type_id,
    )
  )
    typeSelect.append(
      el("option", { value: draft.question_type_id }, item.question_type_name),
    );
  typeSelect.value = draft.question_type_id || "";
  const verdict = el(
    "select",
    {
      id: prefix + "-verdict",
      disabled: fixed,
      onChange: (e) => {
        draft.verdict = e.target.value;
        draft.count_evidence =
          value.mode === "completed" &&
          ["correct", "incorrect"].includes(draft.verdict) &&
          draft.knowledge_ids.length > 0 &&
          !!draft.student_answer.trim() &&
          !!draft.reference_answer.trim();
        countBox.checked = draft.count_evidence;
        edited();
      },
    },
    el("option", { value: "" }, "请选择核对结论"),
    Object.entries(verdictNames)
      .filter(
        ([id]) =>
          value.mode !== "blank" || ["unanswered", "uncertain"].includes(id),
      )
      .map(([id, name]) => el("option", { value: id }, name)),
  );
  verdict.value = draft.verdict;
  const countBox = el("input", {
    type: "checkbox",
    checked: !!draft.count_evidence,
    disabled: fixed || value.mode === "blank",
    onChange: (e) => {
      draft.count_evidence = e.target.checked;
      edited();
    },
  });
  reviewed = el("input", {
    type: "checkbox",
    checked: !!draft.reviewed,
    disabled: fixed,
    onChange: (e) => {
      draft.reviewed = e.target.checked;
    },
  });
  return el(
    "article",
    { class: "panel review-item", "data-item-id": item.id },
    el(
      "div",
      { class: "review-heading" },
      el("h3", {}, `第 ${item.label || index + 1} 题`),
      el(
        "span",
        { class: "ai-status" },
        `第 ${item.page_number} 页 · ${item.confidence === "low" ? "识别需重点核对" : item.confidence === "medium" ? "建议检查细节" : "AI 识别"}`,
      ),
    ),
    textField("题干", "stem", 3),
    item.diagram_description || !fixed
      ? textField("图形关系（如有）", "diagram_description")
      : null,
    textField("学生答案 / 已写步骤", "student_answer"),
    textField("参考答案（AI 建议，请核对）", "reference_answer"),
    el(
      "div",
      { class: "ai-evaluation" },
      el("strong", {}, `AI 初步建议：${verdictNames[item.suggested_verdict]}`),
      el("p", {}, item.reason || "未提供可靠评价依据"),
    ),
    knowledgeChecks,
    el(
      "div",
      { class: "review-verdict" },
      el(
        "label",
        { for: prefix + "-type" },
        item.type_created_by_ai ? "AI 新建题型（可以纠正分类）" : "细分题型",
      ),
      typeSelect,
    ),
    el(
      "div",
      { class: "review-verdict" },
      el(
        "label",
        { for: prefix + "-verdict" },
        fixed ? "最终核对结论" : "你的核对结论",
      ),
      verdict,
    ),
    el("label", { class: "check-line" }, reviewed, "我已对照原页核对本题"),
    el(
      "label",
      { class: "check-line" },
      countBox,
      "将这道题的评价计入学习档案",
    ),
    fixed
      ? el(
          "p",
          { class: "note" },
          item.counted
            ? "已计入掌握证据。"
            : item.duplicate
              ? "发现重复题目，保留本次记录，不重复计分。"
              : "本题未计入掌握证据。",
        )
      : value.mode === "blank"
        ? el(
            "p",
            { class: "note" },
            "空白材料只用于问答与知识范围分析。每题仍需核对题干。",
          )
        : el(
            "p",
            { class: "note" },
            "空题、看不清或超出当前知识范围的题目，请保留为未作答或无法判断。",
          ),
    el(
      "details",
      { class: "material-solution" },
      el("summary", {}, "查看 AI 参考思路"),
      el(
        "ol",
        {},
        item.steps.map((s) => el("li", {}, s)),
      ),
    ),
    el(
      "div",
      { class: "actions" },
      button("问这一题  ↗", () => openMaterialChat(value, item), "light"),
    ),
  );
}
async function recognizeMaterial(id) {
  try {
    await api(`/imports/${id}/recognize`, {});
    materialState.current.status = "processing";
    renderMaterials();
    pollMaterial(id);
  } catch (e) {
    toast(e.message);
  }
}
async function confirmMaterial(id) {
  if (materialState.confirming) return;
  const items = materialState.current.items.map((i) =>
    draftFor(i, materialState.current.mode),
  );
  const error = document.querySelector("#confirmation-error");
  if (items.some((i) => !i.reviewed || !i.verdict)) {
    error.textContent =
      "请逐题选择核对结论，并勾选已核对；不确定的题目可以选无法判断。";
    return;
  }
  materialState.confirming = true;
  renderMaterials();
  try {
    materialState.current = await api(`/imports/${id}/confirm`, { items });
    await loadMaterials();
    await refreshStudent();
  } catch (e) {
    toast(e.message);
  } finally {
    materialState.confirming = false;
    renderMaterials();
  }
}
function reportPanel(value) {
  const r = value.report,
    weak = r.modules.filter((m) => m.incorrect > 0);
  return el(
    "section",
    { class: "panel material-report" },
    el("div", { class: "eyebrow" }, "YOUR REVIEWED LEARNING REPORT"),
    el("h2", {}, "从这份试卷，找到下一步。"),
    el(
      "div",
      { class: "report-counts" },
      Object.entries(r.counts).map(([key, count]) =>
        el("span", {}, el("strong", {}, count), verdictNames[key]),
      ),
    ),
    el(
      "p",
      { class: "assessment" },
      weak.length
        ? `优先关注：${weak.map((m) => m.name).join("、")}。先用基础变式检查原因，再逐步提高难度。`
        : value.mode === "blank"
          ? "这份材料记录了考察范围，没有学生作答证据。"
          : "这份材料暂未确认错题；这还不足以说明所有相关模块都已掌握。",
    ),
    el(
      "div",
      { class: "module-report-list" },
      (r.question_types || []).map((t) =>
        el(
          "div",
          { class: "module-report-row" },
          el(
            "div",
            {},
            el("strong", {}, t.name),
            el(
              "p",
              {},
              `细分题型 · 答对 ${t.correct} · 答错 ${t.incorrect} · 无法判断 ${t.uncertain}`,
            ),
          ),
        ),
      ),
    ),
    el(
      "div",
      { class: "module-report-list" },
      r.modules.map((m) =>
        el(
          "div",
          { class: "module-report-row" },
          el(
            "div",
            {},
            el("strong", {}, m.name),
            el(
              "p",
              {},
              `答对 ${m.correct} · 答错 ${m.incorrect} · 未作答 ${m.unanswered} · 无法判断 ${m.uncertain}`,
            ),
          ),
          button(
            m.incorrect ? "针对练习" : "练一题",
            () => startPractice(m.knowledge_id),
            "light",
          ),
        ),
      ),
    ),
    el("p", { class: "note" }, r.note),
    el(
      "p",
      { class: "note" },
      `本份材料实际计入档案 ${value.items.filter((i) => i.counted).length} 题；这些评价经过用户核对，尚非教师审定。`,
    ),
    button("删除材料及其掌握证据", () => deleteMaterial(value.id), "ghost"),
  );
}
async function deleteMaterial(id) {
  if (
    !window.confirm(
      "删除这份材料、原页和相关讨论？已计入的试卷证据也会撤销，题库练习记录会保留。",
    )
  )
    return;
  try {
    const response = await fetch(`/api/v1/imports/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail);
    materialState.current = null;
    await loadMaterials();
    await refreshStudent();
    renderMaterials();
  } catch (e) {
    toast(e.message);
  }
}
async function openMaterialChat(value, item) {
  materialState.activeItem = item.id;
  materialState.messages = [];
  materialState.chatDraft = "";
  try {
    const response = await api(
      `/imports/${value.id}/items/${item.id}/messages`,
    );
    materialState.messages = response.items;
    renderMaterials();
    document
      .querySelector("#material-chat")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    toast(e.message);
  }
}
function materialChatPanel(value) {
  const item = value.items.find((i) => i.id === materialState.activeItem);
  if (!item) return null;
  const input = el("textarea", {
    "aria-label": "向AI提问拍照题",
    maxlength: 1200,
    required: true,
    placeholder: "例如：我这一步为什么错了？",
    disabled: materialState.chatting,
    onInput: (e) => {
      materialState.chatDraft = e.target.value;
    },
  });
  input.value = materialState.chatDraft;
  const form = el(
    "form",
    {
      class: "chat-form",
      onSubmit: async (e) => {
        e.preventDefault();
        const message = materialState.chatDraft.trim();
        if (!message || materialState.chatting) return;
        const importId = value.id,
          itemId = item.id;
        materialState.chatting = true;
        renderMaterials();
        try {
          const response = await api(
            `/imports/${importId}/items/${itemId}/tutor`,
            { message },
          );
          if (
            materialState.current?.id === importId &&
            materialState.activeItem === itemId
          ) {
            materialState.messages.push({ message, response });
            materialState.chatDraft = "";
            if (value.status !== "confirmed") {
              item.assisted = true;
              if (materialState.drafts[itemId])
                materialState.drafts[itemId].assisted = true;
            }
          }
        } catch (error) {
          toast(error.message);
        } finally {
          materialState.chatting = false;
          renderMaterials();
        }
      },
    },
    input,
    el(
      "button",
      { class: "btn light", type: "submit", disabled: materialState.chatting },
      materialState.chatting ? "正在思考…" : "讨论这一题  ↗",
    ),
  );
  return el(
    "section",
    { class: "panel", id: "material-chat" },
    el("h2", { class: "material-title" }, `第 ${item.label} 题 · 一起想一想`),
    el(
      "p",
      { class: "note" },
      "讨论使用已保存的题干。核对前如有文字识别错误，请在提问中说明；最终确认后会采用你修正的内容。",
    ),
    el(
      "div",
      { class: "chat", role: "log" },
      materialState.messages
        .map((m) => [
          el("div", { class: "bubble user" }, m.message),
          el(
            "div",
            { class: "bubble" },
            m.response.reply + "\n\n" + m.response.check_question,
          ),
        ])
        .flat(),
    ),
    form,
  );
}
