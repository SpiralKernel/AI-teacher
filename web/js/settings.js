"use strict";
const settingsState = {catalog: null, course: null, draft: null, loading: false, saving: false};

function learningLabel() {
  const scope = state.learning?.scope;
  return scope ? `${scope.subject_name} · ${scope.stage_label}` : "选择科目和阶段";
}

function useLearningPreferences(value) {
  const changedSubject = bankState.subject !== value.subject;
  state.learning = value;
  state.allowChallenge = value.allow_challenge;
  bankState.subject = value.subject;
  bankState.course_book_id = value.book_id;
  bankState.course_unit_id = value.unit_id || "";
  bankState.limitCourse = value.limit_course;
  bankState.tag_id = "";
  bankState.offset = 0;
  if (changedSubject) {
    bankState.query = "";
    bankState.difficulty = "";
    bankState.answer_mode = "";
  }
}

async function applyLearningPreferences(update) {
  const current = {...state.learning, ...update};
  const body = Object.fromEntries(["subject", "book_id", "unit_id", "limit_course", "allow_challenge"].map((k) => [k, current[k]]));
  useLearningPreferences(await api("/courses/preferences", body));
}

async function openSettings() {
  if (settingsState.saving) return;
  try {
    const [catalog, course] = await Promise.all([
      api("/bank/catalog"), api("/courses?" + new URLSearchParams({subject: state.learning.subject})),
    ]);
    Object.assign(settingsState, {catalog, course, draft: {...state.learning}, loading: false});
    setView("settings");
  } catch (e) { toast(e.message); }
}

async function settingsSubject(subject) {
  settingsState.loading = true;
  render();
  try {
    const course = await api("/courses?" + new URLSearchParams({subject}));
    settingsState.course = course;
    Object.assign(settingsState.draft, course.setting);
  } catch (e) { toast(e.message); }
  finally { settingsState.loading = false; render(); }
}

async function saveLearningSettings(goToBank = false) {
  if (settingsState.saving || settingsState.loading) return;
  settingsState.saving = true;
  render();
  try {
    await applyLearningPreferences(settingsState.draft);
    settingsState.draft = {...state.learning};
    if (goToBank) {
      await loadBank();
      setView("bank");
    }
    toast("学习设置已保存，下次打开会继续使用。");
  } catch (e) { toast(e.message); }
  finally { settingsState.saving = false; render(); }
}

async function openCurrentBank() {
  try { await loadBank(); setView("bank"); }
  catch (e) { toast(e.message); }
}

function learningOverview() {
  return el("section", {class: "learning-overview", "aria-label": "当前学习范围"},
    el("div", {}, el("span", {class: "eyebrow"}, "当前学习范围"),
      el("h2", {}, learningLabel()), el("p", {}, state.learning.scope.unit_name)),
    el("div", {class: "actions"}, button("切换科目 / 阶段", openSettings, "light"),
      button("进入当前题库 →", openCurrentBank)));
}

function stageHomeView() {
  return el("div", {}, heading("继续你的学习。", "先选择当前阶段，再按目标练习、查看进步。", learningLabel()),
    learningOverview(),
    el("section", {class: "panel"}, el("h2", {}, "按当前阶段开始"),
      el("p", {}, "进入题库可以查看学习目标、知识点和细分题型画像，也可以上传手写解答或阅读长篇材料。"),
      el("p", {class: "note"}, state.learning.scope.scope_note),
      button("查看目标与练习", openCurrentBank)));
}

function settingsView() {
  const {draft, course, catalog} = settingsState;
  if (!draft || !course) return el("p", {}, "正在准备学习设置…");
  const book = course.books.find((b) => b.id === draft.book_id);
  const disabled = settingsState.loading || settingsState.saving;
  const select = (label, values, current, onChange) => {
    const input = el("select", {"aria-label": label, disabled, onChange},
      values.map(([id, name]) => el("option", {value: id}, name)));
    input.value = current || "";
    return el("label", {class: "settings-field"}, el("span", {}, label), input);
  };
  const toggle = (field, label, note) => el("label", {class: "settings-toggle"},
    el("input", {type: "checkbox", checked: draft[field], disabled,
      onChange: (e) => {draft[field] = e.target.checked;}}),
    el("span", {}, el("strong", {}, label), el("small", {}, note)));
  return el("div", {}, heading("设置你的学习。", "科目、年级学期和当前单元，都在这里切换。", "学习设置"),
    el("section", {class: "settings-current", "aria-label": "已保存的学习范围"},
      el("span", {class: "eyebrow"}, "正在使用"), el("strong", {}, learningLabel()),
      el("span", {}, state.learning.scope.unit_name)),
    el("form", {class: "panel settings-form", onSubmit: (e) => {e.preventDefault(); saveLearningSettings();}},
      el("h2", {}, "学习范围"), el("p", {class: "note"}, "各科分别记住学期和单元，保存后用于之后的选题与AI辅导。"),
      el("div", {class: "settings-grid"},
        select("学习科目", catalog.subjects.map((s) => [s.id, s.name]), draft.subject, (e) => settingsSubject(e.target.value)),
        select("年级与学期", course.books.map((b) => [b.id, `${b.grade} 年级 · ${b.term === 1 ? "上学期" : "下学期"}`]), draft.book_id,
          (e) => {draft.book_id = e.target.value; draft.unit_id = null; render();}),
        select("学习单元", [["", "整册 / 本学期"], ...book.units.map((u) => [u.id, u.name])], draft.unit_id,
          (e) => {draft.unit_id = e.target.value || null;})),
      el("div", {class: "settings-basis"}, el("strong", {}, book.edition), el("p", {}, book.scope_note)),
      el("h2", {}, "练习偏好"),
      toggle("limit_course", "仅练当前学习范围", "按本学期或所选单元筛选候选题。"),
      toggle("allow_challenge", "允许穿插挑战题", "自动练习可适当加入难题；也可以在题库手动选择难度。"),
      el("div", {class: "actions"},
        el("button", {class: "btn", type: "submit", disabled}, settingsState.saving ? "保存中…" : "保存设置"),
        el("button", {class: "btn light", type: "button", disabled, onClick: () => saveLearningSettings(true)}, "保存并进入题库"))),
    el("p", {class: "note"}, "科学与理化生可按学校实际课程选用；体音美不在当前范围内。"));
}
