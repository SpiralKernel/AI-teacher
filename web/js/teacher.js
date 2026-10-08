/** AI 老师页面与题目内的即时提问面板。 */
export function createTeacherUI(ui) {
  const { S, el, btn, field, api, action, error, refresh, render, math } = ui;
  const empty = () => ({
    threadId: null,
    messages: [],
    draft: "",
    files: [],
    context: {},
    requestId: null,
  });
  let main = empty(),
    drawer = null,
    history = [];
  function reset() {
    main = empty();
    drawer = null;
    history = [];
  }
  async function open(context) {
    if (!drawer || drawer.context.attempt_id !== context.attempt_id)
      drawer = { ...empty(), context };
    drawer.open = true;
    render();
    document.querySelector("#drawer-teacher-text")?.focus();
  }
  function close() {
    if (drawer) drawer.open = false;
    const y = scrollY;
    render();
    requestAnimationFrame(() => scrollTo({ top: y }));
  }
  async function newChat() {
    main = empty();
    render();
    document.querySelector("#main-teacher-text")?.focus();
  }
  async function loadHistory() {
    history = (await api("/teacher/threads")).items;
    render();
  }
  async function restore(id) {
    const value = await api("/teacher/threads/" + id);
    main = {
      ...empty(),
      threadId: id,
      messages: value.items,
      context: value.context,
    };
    render();
  }
  function entry(label, description, mark, fn) {
    return el(
      "button",
      { type: "button", class: "teacher-entry", onClick: () => action(fn) },
      el("span", { class: "entry-mark", "aria-hidden": "true" }, mark),
      el("span", {}, el("strong", {}, label), el("small", {}, description)),
      el("span", { "aria-hidden": "true" }, "↗"),
    );
  }
  function imageConfirmation(item, target) {
    const response = item.response;
    if (!response.images?.length || !response.transcribed_answer) return null;
    if (response.image_confirmation)
      return el("small", {}, "图片作答已核对，后续讨论会参考核对后的内容。");
    item.imageQuestion ??= response.recognized_question || "";
    item.imageAnswer ??= response.transcribed_answer;
    return el(
      "details",
      { class: "recognized-question" },
      el("summary", {}, "核对图片中的作答"),
      el(
        "p",
        {},
        "先核对题干和你的作答，确认后再用于学情判断。看不清的内容可以修改。",
      ),
      el("textarea", {
        "aria-label": "核对图片题干",
        value: item.imageQuestion,
        maxLength: 5000,
        onInput: (e) => {
          item.imageQuestion = e.target.value;
          item.imageRequestId = null;
        },
      }),
      el("textarea", {
        "aria-label": "核对图片作答",
        value: item.imageAnswer,
        maxLength: 12000,
        onInput: (e) => {
          item.imageAnswer = e.target.value;
          item.imageRequestId = null;
        },
      }),
      btn("确认作答并分析", async () => {
        if (!item.imageQuestion.trim() || !item.imageAnswer.trim())
          throw new Error("请补全并核对图片题干和作答。");
        item.imageRequestId ||= crypto.randomUUID();
        const value = await api(
          `/teacher/threads/${target.threadId}/messages/${response.message_id}/confirm-image`,
          {
            reviewed: true,
            recognized_question: item.imageQuestion,
            student_answer: item.imageAnswer,
            request_id: item.imageRequestId,
          },
        );
        response.image_confirmation = { message_id: value.message_id };
        if (
          !target.messages.some(
            (m) => m.response.message_id === value.message_id,
          )
        )
          target.messages.push({
            message: "请检查我核对后的图片作答。",
            response: value,
          });
        await refresh();
        render();
      }),
    );
  }
  function messages(target) {
    return el(
      "div",
      { class: "teacher-messages", "aria-live": "polite" },
      target.messages.length
        ? target.messages.map((item) =>
            el(
              "article",
              { class: "dialogue-pair" },
              el(
                "div",
                { class: "message user" },
                el("div", { class: "author" }, "我"),
                el("div", {}, item.message),
                (item.response.images || []).map((im) =>
                  el("img", {
                    src: im.url,
                    alt: "本次提问的题目图片",
                    class: "chat-photo",
                    loading: "lazy",
                  }),
                ),
              ),
              el(
                "div",
                { class: "message" },
                el("div", { class: "author" }, "AI老师"),
                item.response.recognized_question
                  ? el(
                      "details",
                      { class: "recognized-question" },
                      el("summary", {}, "识别到的题目"),
                      el("p", {}, item.response.recognized_question),
                    )
                  : null,
                el("div", { class: "reply" }, item.response.reply),
                imageConfirmation(item, target),
                item.response.check_question
                  ? el(
                      "div",
                      { class: "check-question" },
                      item.response.check_question,
                    )
                  : null,
                (item.response.observations || []).map((note) =>
                  el(
                    "div",
                    { class: "learning-note" },
                    el("span", {}, "已记录 · " + note.note),
                    note.dismissed
                      ? el("small", {}, "已撤回")
                      : btn(
                          "记录不准确",
                          async () => {
                            await api(
                              "/teacher/observations/" + note.id + "/dismiss",
                              {},
                            );
                            note.dismissed = true;
                            await refresh();
                            render();
                          },
                          "note-dismiss",
                        ),
                  ),
                ),
                item.response.state_update?.rejected?.length
                  ? el(
                      "small",
                      {},
                      item.response.state_update.review_unavailable
                        ? "学情复核暂未完成，本次讲解已保存，相关学习状态暂未更新。"
                        : "部分学习判断的依据还不足，暂未记录；可以继续解释你的思路。",
                    )
                  : null,
              ),
            ),
          )
        : el(
            "div",
            { class: "teacher-empty" },
            el("span", { "aria-hidden": "true" }, "✦"),
            el("p", {}, "知识概念、一道题、卡住的一步，都可以从这里问起。"),
          ),
    );
  }
  async function send(target) {
    const message =
      target.draft.trim() ||
      (target.files.length ? "请帮我理解这道图片题。" : "");
    if (!message) throw new Error("写下你的问题，或上传题目照片。");
    target.requestId ||= crypto.randomUUID();
    const body = {
      message,
      thread_id: target.threadId,
      request_id: target.requestId,
      ...target.context,
      student_draft: target.context.attempt_id ? S.answer : "",
    };
    target.pending = true;
    render();
    let response;
    try {
      if (target.files.length) {
        const data = new FormData();
        for (const [k, v] of Object.entries(body))
          if (v !== null && v !== undefined) data.append(k, v);
        target.files.forEach((f) => data.append("files", f));
        response = await api("/teacher/photo", data);
      } else response = await api("/teacher/chat", body);
    } finally {
      target.pending = false;
      render();
    }
    target.threadId = response.thread_id;
    target.messages.push({ message, response });
    target.draft = "";
    target.files = [];
    target.requestId = null;
    await refresh();
    render();
    document
      .querySelector(
        target === main ? "#main-teacher-text" : "#drawer-teacher-text",
      )
      ?.focus();
  }
  function composer(target, prefix) {
    const text = el("textarea", {
      id: prefix + "-teacher-text",
      "aria-label": prefix === "main" ? "向 AI 提问" : "就这道题向 AI 提问",
      value: target.draft,
      maxLength: 1600,
      placeholder: "比如：绝对值为什么不能是负数？",
      onInput: (e) => {
        target.draft = e.target.value;
        target.requestId = null;
      },
    });
    const file = el("input", {
      id: prefix + "-teacher-photo",
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      multiple: true,
      class: "visually-hidden",
      "aria-label": prefix === "main" ? "拍照问题目" : "为这道题添加图片",
      onChange: (e) => {
        const files = [...e.target.files];
        if (files.length > 4) {
          e.target.value = "";
          error("每次最多4张图片。");
          return;
        }
        target.files = files;
        target.requestId = null;
        render();
        document.querySelector("#" + prefix + "-teacher-text")?.focus();
      },
    });
    return el(
      "form",
      {
        class: "teacher-composer",
        onSubmit: (e) => {
          e.preventDefault();
          action(() => send(target));
        },
      },
      text,
      target.pending
        ? el(
            "p",
            { class: "thinking-note", role: "status" },
            "AI老师正在思考，请稍候…",
          )
        : null,
      file,
      target.files.length
        ? el(
            "div",
            { class: "attachments" },
            el("span", {}, `已选择 ${target.files.length} 张图片`),
            btn(
              "移除图片",
              () => {
                target.files = [];
                render();
              },
              "quiet",
            ),
          )
        : null,
      el(
        "div",
        { class: "composer-toolbar" },
        el(
          "label",
          { class: "photo-trigger", htmlFor: prefix + "-teacher-photo" },
          "＋ 添加题目图片",
        ),
        el("span", { class: "tiny" }, "提问也会留下学习线索"),
        el("button", { type: "submit", class: "primary" }, "发送问题"),
      ),
    );
  }
  function page() {
    return el(
      "section",
      { class: "teacher-page" },
      el(
        "div",
        { class: "teacher-hero" },
        el("p", { class: "eyebrow" }, "AI老师 · 随时提问，慢慢理解"),
        el("h1", {}, "先从一个问题开始。"),
        el(
          "p",
          { class: "subtle" },
          `${S.student.nickname}，问知识、拍题目，或者一起看懂卡住的那一步。`,
        ),
      ),
      el(
        "div",
        { class: "teacher-entries" },
        entry("问知识", "把概念讲明白", "知", () =>
          document.querySelector("#main-teacher-text")?.focus(),
        ),
        entry("拍照问题", "读懂题意和思路", "题", () =>
          document.querySelector("#main-teacher-photo")?.click(),
        ),
        entry("导入练习", "已有习题与已做试卷", "练", () => {
          S.aiPanel = "imports";
          render();
        }),
      ),
      el(
        "section",
        { class: "card teacher-chat" },
        el(
          "div",
          { class: "kicker" },
          el(
            "h2",
            {},
            main.context.source ? "围绕这道题，一起想一想" : "和 AI老师聊一聊",
          ),
          btn("新提问", newChat, "quiet"),
        ),
        main.context.source
          ? el("p", { class: "tiny" }, "这段讨论关联一份已识别的练习。")
          : null,
        messages(main),
        composer(main, "main"),
      ),
      el(
        "details",
        {
          class: "card history-list",
          open: history.length > 0,
          onToggle: (e) => {
            if (e.target.open && !history.length) action(loadHistory);
          },
        },
        el("summary", {}, "最近的提问"),
        history.map((h) => btn(h.title, () => restore(h.id), "history-item")),
      ),
    );
  }
  function panel() {
    if (!drawer?.open) return null;
    const node = el(
      "div",
      { class: "teacher-drawer-shade" },
      el(
        "section",
        {
          class: "teacher-drawer",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "这道题的 AI老师",
        },
        el(
          "div",
          { class: "kicker" },
          el(
            "div",
            {},
            el("p", { class: "eyebrow" }, "题目内即时提问"),
            el("h2", {}, "问问 AI老师"),
          ),
          btn("关闭问答", close, "quiet"),
        ),
        el("p", { class: "subtle" }, "当前题目和你已写的解答会一起交给老师。"),
        el(
          "div",
          { class: "quick-prompts" },
          ["解释题意", "给一点提示", "看看我这一步"].map((t) =>
            btn(
              t,
              () => {
                drawer.draft = t;
                render();
                document.querySelector("#drawer-teacher-text")?.focus();
              },
              "quiet",
            ),
          ),
        ),
        messages(drawer),
        composer(drawer, "drawer"),
      ),
    );
    node.addEventListener("click", (e) => {
      if (e.target === node) close();
    });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const items = [
          ...node.querySelectorAll("button,textarea,input"),
        ].filter((n) => !n.disabled && n.offsetParent !== null);
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    });
    return node;
  }
  function discussImport(importId, itemId, stem) {
    main = {
      ...empty(),
      context: { source: "import", import_id: importId, item_id: itemId },
      draft: "请帮我理解这道题：" + stem.slice(0, 300),
    };
    S.aiPanel = null;
    S.mode = "ai";
    render();
  }
  return { page, panel, open, reset, discussImport, close };
}
