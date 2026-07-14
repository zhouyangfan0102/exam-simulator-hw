const state = {
  bankName: "题库",
  currentBank: "",
  banks: [],
  subjects: [],
  mode: "random",
  examId: null,
  questions: [],
  submitted: false,
  checked: new Map(),
  marked: new Set(),
  currentIndex: 0,
  startedAt: null,
  elapsedSeconds: 0,
  timerId: null,
  examRequestId: 0,
};

const els = {
  appTitle: document.querySelector("#appTitle"),
  bankSwitcher: document.querySelector("#bankSwitcher"),
  bankDropdown: document.querySelector("#bankDropdown"),
  bankMenuButton: document.querySelector("#bankMenuButton"),
  bankMenuText: document.querySelector("#bankMenuText"),
  bankMenu: document.querySelector("#bankMenu"),
  bankMeta: document.querySelector("#bankMeta"),
  brandActions: document.querySelector("#brandActions"),
  bankUpload: document.querySelector("#bankUpload"),
  formatUpload: document.querySelector("#formatUpload"),
  topControls: document.querySelector("#topControls"),
  subjectList: document.querySelector("#subjectList"),
  refreshBtn: document.querySelector("#refreshBtn"),
  selectAllBtn: document.querySelector("#selectAllBtn"),
  clearAllBtn: document.querySelector("#clearAllBtn"),
  searchInput: document.querySelector("#searchInput"),
  searchBtn: document.querySelector("#searchBtn"),
  searchResults: document.querySelector("#searchResults"),
  segments: [...document.querySelectorAll(".segment")],
  countField: document.querySelector("#countField"),
  questionCount: document.querySelector("#questionCount"),
  shuffleAll: document.querySelector("#shuffleAll"),
  startBtn: document.querySelector("#startBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  statusResetBtn: document.querySelector("#statusResetBtn"),
  scoreCard: document.querySelector("#scoreCard"),
  scoreValue: document.querySelector("#scoreValue"),
  scoreText: document.querySelector("#scoreText"),
  notice: document.querySelector("#notice"),
  examStatus: document.querySelector("#examStatus"),
  statusTotal: document.querySelector("#statusTotal"),
  statusAnswered: document.querySelector("#statusAnswered"),
  statusCorrect: document.querySelector("#statusCorrect"),
  statusAccuracy: document.querySelector("#statusAccuracy"),
  statusElapsed: document.querySelector("#statusElapsed"),
  examLayout: document.querySelector("#examLayout"),
  questionForm: document.querySelector("#questionForm"),
  questionNav: document.querySelector("#questionNav"),
};

let scrollSyncId = 0;

function requestPageScrollSync() {
  if (scrollSyncId) {
    cancelAnimationFrame(scrollSyncId);
  }
  scrollSyncId = requestAnimationFrame(() => {
    scrollSyncId = 0;
    const isHome = !els.topControls.classList.contains("hidden");
    if (!isHome) {
      document.body.classList.remove("home-no-scroll");
      return;
    }

    document.body.classList.remove("home-no-scroll");
    const viewportHeight = document.documentElement.clientHeight;
    const container = document.querySelector(".container");
    const contentBottom = container
      ? container.getBoundingClientRect().bottom + window.scrollY
      : Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    document.body.classList.toggle("home-no-scroll", contentBottom <= viewportHeight + 2);
  });
}

function showNotice(message, type = "info") {
  if (!message) {
    els.notice.classList.add("hidden");
    els.notice.textContent = "";
    requestPageScrollSync();
    return;
  }
  els.notice.textContent = message;
  els.notice.dataset.type = type;
  els.notice.classList.remove("hidden");
  requestPageScrollSync();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

async function uploadApi(path, formData) {
  const response = await fetch(path, {
    method: "POST",
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "上传失败");
  }
  return payload;
}

async function formatApi(path, formData) {
  const response = await fetch(path, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    let message = "整理失败";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      message = await response.text() || message;
    }
    throw new Error(message);
  }
  return {
    blob: await response.blob(),
    count: response.headers.get("X-Question-Count") || "",
  };
}

function bankTitle(value) {
  const raw = String(value || "").replace(/\\/g, "/").split("/").pop() || "题库";
  return raw.replace(/\.[^.]+$/, "") || raw;
}

function bankMetaText(total) {
  return `共 ${Number(total) || 0} 题`;
}

function setHeaderExamMode(enabled) {
  if (enabled) {
    const title = `${state.bankName || "题库"}考试`;
    els.appTitle.textContent = title;
    document.title = title;
    els.bankSwitcher.classList.add("hidden");
    els.brandActions.classList.add("hidden");
    requestPageScrollSync();
    return;
  }
  els.appTitle.textContent = "考试模拟系统";
  document.title = "考试模拟系统";
  els.bankSwitcher.classList.remove("hidden");
  els.brandActions.classList.remove("hidden");
  requestPageScrollSync();
}

function selectedSubjects() {
  return [...document.querySelectorAll(".subject-item input:checked")].map((input) => input.value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSubjects() {
  els.subjectList.innerHTML = "";
  if (!state.subjects.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "暂无可用学科";
    els.subjectList.appendChild(empty);
    requestPageScrollSync();
    return;
  }

  state.subjects.forEach((subject) => {
    const label = document.createElement("label");
    label.className = "subject-item";
    label.dataset.fullName = `${subject.name}（${subject.count} 题）`;
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(subject.name)}" aria-label="${escapeHtml(subject.name)}" checked />
      <span class="subject-name">${escapeHtml(subject.name)}</span>
      <span class="count-pill">${subject.count}</span>
    `;
    els.subjectList.appendChild(label);
  });
  requestPageScrollSync();
}

function renderBankSelect() {
  const banks = state.banks.length
    ? state.banks
    : [{ filename: state.currentBank, name: state.bankName, total: state.subjects.reduce((sum, item) => sum + item.count, 0) }];
  const availableBanks = banks.filter((bank) => bank.filename);
  const current = availableBanks.find((bank) => bank.filename === state.currentBank) || availableBanks[0];
  els.bankMenuText.textContent = current ? bankTitle(current.name || current.filename) : "暂无可用题库";
  els.bankMenuText.title = current ? bankTitle(current.name || current.filename) : "";
  els.bankMenu.innerHTML = availableBanks.map((bank) => {
    const title = bankTitle(bank.name || bank.filename);
    const selected = bank.filename === state.currentBank;
    return `
      <button class="bank-menu-item${selected ? " is-selected" : ""}" type="button" role="option"
        data-bank-filename="${escapeHtml(bank.filename)}" aria-selected="${selected}" title="${escapeHtml(title)}">
        <span>${escapeHtml(title)}</span>
        <small>${Number(bank.total) || 0} 题</small>
      </button>
    `;
  }).join("");
  els.bankMenuButton.disabled = !availableBanks.length;
  closeBankMenu();
}

function closeBankMenu() {
  els.bankMenu.classList.add("hidden");
  els.bankDropdown.classList.remove("is-open");
  els.bankMenuButton.setAttribute("aria-expanded", "false");
}

function toggleBankMenu() {
  if (els.bankMenuButton.disabled) {
    return;
  }
  const willOpen = els.bankMenu.classList.contains("hidden");
  els.bankMenu.classList.toggle("hidden", !willOpen);
  els.bankDropdown.classList.toggle("is-open", willOpen);
  els.bankMenuButton.setAttribute("aria-expanded", String(willOpen));
}

function clearSearchResults(clearInput = false) {
  if (clearInput) {
    els.searchInput.value = "";
  }
  els.searchResults.innerHTML = "";
  els.searchResults.classList.add("hidden");
  requestPageScrollSync();
}

function applyBankData(data) {
  state.subjects = data.subjects || [];
  state.bankName = bankTitle(data.name || data.file);
  state.currentBank = data.currentBank?.filename || data.filename || "";
  state.banks = data.banks || [];
  renderBankSelect();
  renderSubjects();
  els.bankMeta.textContent = bankMetaText(data.total);
}

function renderSearchResults(data) {
  const questions = data.questions || [];
  const summary = questions.length
    ? `找到 ${data.total} 道相关题目${data.truncated ? `，显示前 ${questions.length} 道` : ""}`
    : "没有找到相关题目";
  const rows = questions.map((question) => `
    <article class="search-result-item">
      <div class="search-result-meta">
        <span>${escapeHtml(question.subject)}</span>
        <span>${escapeHtml(question.type || "未分类")}</span>
        <span>第 ${Number(question.row) || "-"} 行</span>
        <strong>答案：${escapeHtml(question.answer || "未填写")}</strong>
      </div>
      <p>${escapeHtml(question.question)}</p>
    </article>
  `).join("");
  els.searchResults.innerHTML = `<div class="search-summary">${summary}</div>${rows}`;
  els.searchResults.classList.remove("hidden");
  requestPageScrollSync();
}

function formatElapsed(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainSeconds = safeSeconds % 60;
  const parts = [minutes, remainSeconds].map((item) => String(item).padStart(2, "0"));
  return hours ? `${String(hours).padStart(2, "0")}:${parts.join(":")}` : parts.join(":");
}

function currentElapsedSeconds() {
  if (!state.startedAt) {
    return state.elapsedSeconds;
  }
  return Math.floor((Date.now() - state.startedAt) / 1000);
}

function stopExamTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  if (state.startedAt) {
    state.elapsedSeconds = currentElapsedSeconds();
    state.startedAt = null;
  }
}

function startExamTimer() {
  stopExamTimer();
  state.startedAt = Date.now();
  state.elapsedSeconds = 0;
  updateExamStatus();
  state.timerId = setInterval(updateExamStatus, 1000);
}

function answeredQuestionCount() {
  return [...els.questionForm.querySelectorAll(".answer-value")].filter((input) => input.value).length;
}

function updateExamStatus() {
  const total = state.questions.length;
  const answered = answeredQuestionCount();
  const checkedResults = [...state.checked.values()];
  const correct = checkedResults.filter((item) => item.correct).length;
  const accuracy = checkedResults.length ? Math.round((correct / checkedResults.length) * 100) : 0;

  els.statusTotal.textContent = String(total);
  els.statusAnswered.textContent = String(answered);
  els.statusCorrect.textContent = String(correct);
  els.statusAccuracy.textContent = `${accuracy}%`;
  els.statusElapsed.textContent = formatElapsed(currentElapsedSeconds());
}

function normalizeFullwidth(value) {
  return String(value)
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .trim();
}

function normalizeOptionKey(value) {
  return normalizeFullwidth(value).toUpperCase();
}

function answerMode(type) {
  if (String(type).includes("多")) {
    return "multiple";
  }
  if (String(type).includes("判")) {
    return "judge";
  }
  return "single";
}

function parseOptions(text) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const stemLines = [];
  const options = [];

  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Ha-hＡ-Ｈａ-ｈ])\s*[\.\uFF0E、:：\)）]\s*(.*)$/);
    if (match) {
      options.push({
        key: normalizeOptionKey(match[1]),
        text: match[2].trim(),
      });
      return;
    }
    if (options.length) {
      const last = options[options.length - 1];
      last.text = `${last.text}${last.text ? "\n" : ""}${line.trim()}`.trim();
      return;
    }
    stemLines.push(line);
  });

  if (options.length >= 2) {
    return {
      stem: stemLines.join("\n").trim() || source.trim(),
      options,
    };
  }

  const markers = [...source.matchAll(/([A-Ha-hＡ-Ｈａ-ｈ])\s*[\.\uFF0E、:：\)）]\s*/g)];
  if (markers.length >= 2) {
    const inlineOptions = markers.map((marker, index) => {
      const next = markers[index + 1];
      const start = marker.index + marker[0].length;
      const end = next ? next.index : source.length;
      return {
        key: normalizeOptionKey(marker[1]),
        text: source.slice(start, end).trim(),
      };
    });
    return {
      stem: source.slice(0, markers[0].index).trim() || source.trim(),
      options: inlineOptions,
    };
  }

  return { stem: source.trim(), options: [] };
}

function fallbackOptions() {
  return ["A", "B", "C", "D"].map((key) => ({ key, text: key }));
}

function prepareQuestion(question) {
  const mode = answerMode(question.type);
  if (mode === "judge") {
    return {
      mode,
      stem: question.question,
      options: [
        { key: "对", text: "对" },
        { key: "错", text: "错" },
      ],
    };
  }

  const parsed = parseOptions(question.question);
  return {
    mode,
    stem: parsed.options.length ? parsed.stem : question.question,
    options: parsed.options.length ? parsed.options : fallbackOptions(),
  };
}

function renderChoiceButtons(prepared) {
  const optionHtml = prepared.options
    .map(
      (option) => `
        <button class="choice-button" type="button" data-value="${escapeHtml(option.key)}" aria-pressed="false">
          <span class="choice-key">${escapeHtml(option.key)}</span>
          <span class="choice-text">${escapeHtml(option.text)}</span>
        </button>
      `,
    )
    .join("");
  return `<div class="choice-grid ${prepared.mode === "judge" ? "judge-grid" : ""}">${optionHtml}</div>`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadSubjects() {
  els.bankMeta.textContent = "正在读取...";
  showNotice("");
  try {
    const data = await api("/api/subjects");
    applyBankData(data);
    clearSearchResults(true);
    if (data.message) {
      showNotice(data.message);
    }
  } catch (error) {
    state.subjects = [];
    state.banks = [];
    state.currentBank = "";
    state.bankName = "题库";
    renderBankSelect();
    renderSubjects();
    els.bankMeta.textContent = "题库读取失败";
    showNotice(error.message, "error");
  }
}

async function switchBank(filename) {
  if (!filename || filename === state.currentBank) {
    return;
  }
  els.bankMenuButton.disabled = true;
  closeBankMenu();
  showNotice("正在切换题库...");
  try {
    const data = await api("/api/banks/select", {
      method: "POST",
      body: JSON.stringify({ filename }),
    });
    clearCurrentExam();
    applyBankData(data);
    clearSearchResults(true);
    showNotice(data.message || "题库切换成功。");
  } catch (error) {
    showNotice(error.message, "error");
    renderBankSelect();
  } finally {
    els.bankMenuButton.disabled = !els.bankMenu.children.length;
  }
}

async function searchQuestions() {
  const keyword = els.searchInput.value.trim();
  if (!keyword) {
    clearSearchResults();
    showNotice("请输入要搜索的关键词。");
    els.searchInput.focus();
    return;
  }
  els.searchBtn.disabled = true;
  showNotice("");
  try {
    const params = new URLSearchParams({ q: keyword, bank: state.currentBank, limit: "80" });
    const data = await api(`/api/search?${params.toString()}`);
    renderSearchResults(data);
  } catch (error) {
    clearSearchResults();
    showNotice(error.message, "error");
  } finally {
    els.searchBtn.disabled = false;
  }
}

function clearCurrentExam() {
  state.examRequestId += 1;
  stopExamTimer();
  state.examId = null;
  state.questions = [];
  state.submitted = false;
  state.checked = new Map();
  state.marked = new Set();
  state.currentIndex = 0;
  state.elapsedSeconds = 0;
  els.questionForm.innerHTML = "";
  els.questionNav.innerHTML = "";
  setHeaderExamMode(false);
  els.topControls.classList.remove("hidden");
  els.examStatus.classList.add("hidden");
  els.examLayout.classList.add("hidden");
  els.questionForm.classList.add("hidden");
  els.scoreCard.classList.add("hidden");
  els.startBtn.disabled = false;
  updateExamStatus();
  requestPageScrollSync();
}

async function formatQuestionList(file) {
  if (!file) {
    return;
  }
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".docx") && !lowerName.endsWith(".xlsx")) {
    showNotice("请上传 .docx 或 .xlsx 格式的题目清单。");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  showNotice(`正在整理：${bankTitle(file.name)}`);

  try {
    const { blob, count } = await formatApi("/api/format", formData);
    downloadBlob(blob, `${bankTitle(file.name)}_整理后.xlsx`);
    showNotice(`题库整理完成${count ? `，共识别 ${count} 道题` : ""}。请检查下载的 Excel 后再上传题库。`);
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    els.formatUpload.value = "";
  }
}

async function uploadBankFile(file) {
  if (!file) {
    return;
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    showNotice("请上传 .xlsx 格式的 Excel 文件。");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  els.bankMeta.textContent = `正在上传：${bankTitle(file.name)}`;
  showNotice("");

  try {
    const data = await uploadApi("/api/upload", formData);
    clearCurrentExam();
    applyBankData(data);
    clearSearchResults(true);
    showNotice(data.message || "题库上传成功。");
  } catch (error) {
    showNotice(error.message, "error");
    loadSubjects();
  } finally {
    els.bankUpload.value = "";
  }
}

function setMode(mode) {
  state.mode = mode;
  els.segments.forEach((segment) => {
    segment.classList.toggle("active", segment.dataset.mode === mode);
  });
  const randomMode = mode === "random";
  els.countField.classList.toggle("is-disabled", !randomMode);
  els.questionCount.disabled = !randomMode;
}

async function startExam() {
  if (els.startBtn.disabled) {
    return;
  }
  const subjects = selectedSubjects();
  if (!subjects.length) {
    showNotice("请至少选择一门学科。");
    return;
  }

  els.startBtn.disabled = true;
  const requestId = state.examRequestId + 1;
  state.examRequestId = requestId;
  try {
    const data = await api("/api/exams", {
      method: "POST",
      body: JSON.stringify({
        subjects,
        mode: state.mode,
        count: Number(els.questionCount.value),
        shuffle: els.shuffleAll.checked,
      }),
    });
    if (requestId !== state.examRequestId) {
      return;
    }
    state.examId = data.examId;
    state.questions = data.questions || [];
    state.submitted = false;
    state.checked = new Map();
    state.marked = new Set();
    state.currentIndex = 0;
    startExamTimer();
    renderExam();
    showNotice("");
  } catch (error) {
    if (requestId === state.examRequestId) {
      els.startBtn.disabled = false;
      showNotice(error.message, "error");
    }
  }
}

function renderExam() {
  setHeaderExamMode(true);
  els.topControls.classList.add("hidden");
  els.examStatus.classList.remove("hidden");
  els.examLayout.classList.remove("hidden");
  els.questionForm.classList.remove("hidden");
  els.scoreCard.classList.add("hidden");
  els.startBtn.disabled = true;
  els.questionForm.innerHTML = "";

  state.questions.forEach((question, index) => {
    const prepared = prepareQuestion(question);
    const card = document.createElement("article");
    card.className = "question-card";
    card.dataset.id = question.id;
    card.dataset.index = String(index);
    card.dataset.answerMode = prepared.mode;
    card.innerHTML = `
      <div class="question-head">
        <div class="question-meta">
          <span class="index-badge">${index + 1}</span>
          <span class="type-badge">${escapeHtml(question.type || "未分类")}</span>
          <span class="subject-badge" title="${escapeHtml(question.subject)}">${escapeHtml(question.subject)}</span>
        </div>
        <span class="result-badge hidden"></span>
      </div>
      <p class="question-text">${escapeHtml(prepared.stem)}</p>
      <input class="answer-value" name="${escapeHtml(question.id)}" type="hidden" />
      ${renderChoiceButtons(prepared)}
      <div class="answer-review hidden"></div>
      <div class="question-actions">
        <button class="mark-button" data-action="mark" type="button">标记题目</button>
        <button class="submit-answer-button" data-action="check" type="button">提交答案</button>
        <button class="finish-button" data-action="finish" type="button">交卷</button>
      </div>
    `;
    els.questionForm.appendChild(card);
  });

  renderQuestionNav();
  showQuestion(0);
  updateExamStatus();
  requestPageScrollSync();
}

function renderQuestionNav() {
  els.questionNav.innerHTML = "";
  state.questions.forEach((question, index) => {
    const button = document.createElement("button");
    button.className = "nav-item";
    button.type = "button";
    button.dataset.index = String(index);
    button.dataset.id = question.id;
    button.textContent = String(index + 1);
    button.title = `${index + 1}. ${question.subject} ${question.type}`;
    els.questionNav.appendChild(button);
  });
  updateQuestionNav();
}

function updateQuestionNav() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    const index = Number(button.dataset.index);
    const questionId = button.dataset.id;
    const result = state.checked.get(questionId);
    button.classList.toggle("current", index === state.currentIndex);
    button.classList.toggle("marked", state.marked.has(questionId));
    button.classList.toggle("correct", Boolean(result?.correct));
    button.classList.toggle("wrong", Boolean(result && !result.correct));
  });
}

function showQuestion(index) {
  if (index < 0 || index >= state.questions.length) {
    return;
  }
  const scrollLeft = window.scrollX;
  const scrollTop = window.scrollY;
  state.currentIndex = index;
  document.querySelectorAll(".question-card").forEach((card) => {
    card.classList.toggle("hidden", Number(card.dataset.index) !== index);
  });
  updateQuestionNav();
  requestAnimationFrame(() => {
    window.scrollTo(scrollLeft, scrollTop);
  });
}

function currentCard() {
  return document.querySelector(`.question-card[data-index="${state.currentIndex}"]`);
}

function compactAnswer(value) {
  return normalizeFullwidth(value)
    .toUpperCase()
    .replace(/[\s\.,。:：,，、;；\/|]/g, "");
}

function booleanAnswerKey(value) {
  const compact = compactAnswer(value);
  const trueValues = new Set(["TRUE", "T", "YES", "Y", "1", "对", "正确", "是", "√", "V"]);
  const falseValues = new Set(["FALSE", "F", "NO", "N", "0", "错", "错误", "否", "×", "X"]);
  if (trueValues.has(compact)) {
    return "对";
  }
  if (falseValues.has(compact)) {
    return "错";
  }
  return compact;
}

function answerKeys(value, mode) {
  if (mode === "judge") {
    const key = booleanAnswerKey(value);
    return key ? [key] : [];
  }
  return [...compactAnswer(value)].filter(Boolean);
}

function clearQuestionFeedback(card) {
  card.classList.remove("correct", "wrong", "checking");
  state.checked.delete(card.dataset.id);
  const badge = card.querySelector(".result-badge");
  badge.textContent = "";
  badge.classList.remove("correct", "wrong");
  badge.classList.add("hidden");
  card.querySelectorAll(".choice-button").forEach((button) => {
    button.classList.remove("choice-correct", "choice-wrong");
  });
  const review = card.querySelector(".answer-review");
  review.innerHTML = "";
  review.classList.add("hidden");
  updateLiveScore();
  updateQuestionNav();
}

function applyQuestionFeedback(card, item, { lock = false } = {}) {
  card.classList.toggle("correct", item.correct);
  card.classList.toggle("wrong", !item.correct);
  card.classList.remove("checking");
  const badge = card.querySelector(".result-badge");
  badge.textContent = item.correct ? "正确" : "错误";
  badge.classList.toggle("correct", item.correct);
  badge.classList.toggle("wrong", !item.correct);
  badge.classList.remove("hidden");

  const mode = card.dataset.answerMode;
  const yourKeys = new Set(answerKeys(item.yourAnswer, mode));
  const correctKeys = new Set(answerKeys(item.correctAnswer, mode));
  card.querySelectorAll(".choice-button").forEach((button) => {
    const value = button.dataset.value;
    button.disabled = lock;
    button.classList.remove("choice-correct", "choice-wrong");
    button.classList.toggle("choice-correct", correctKeys.has(value));
    button.classList.toggle("choice-wrong", yourKeys.has(value) && !correctKeys.has(value));
  });

  const review = card.querySelector(".answer-review");
  review.innerHTML = `
    <div>你的答案：<strong>${escapeHtml(item.yourAnswer || "未作答")}</strong></div>
    <div>正确答案：<strong>${escapeHtml(item.correctAnswer || "（空）")}</strong></div>
  `;
  review.classList.remove("hidden");
}

function updateLiveScore() {
  const totalChecked = state.checked.size;
  if (!totalChecked) {
    els.scoreCard.classList.add("hidden");
    updateExamStatus();
    return;
  }
  const correct = [...state.checked.values()].filter((item) => item.correct).length;
  els.scoreCard.classList.remove("hidden");
  els.scoreValue.textContent = `${correct}/${totalChecked}`;
  els.scoreText.textContent = "已判题";
  updateExamStatus();
}

async function checkQuestion(card = currentCard()) {
  if (!card || state.submitted) {
    return;
  }
  const input = card.querySelector(".answer-value");
  const answer = input.value;
  if (!answer) {
    showNotice("请先选择答案，再提交本题。");
    return;
  }

  const sequence = Number(card.dataset.checkSequence || "0") + 1;
  card.dataset.checkSequence = String(sequence);
  card.classList.add("checking");

  try {
    const result = await api(`/api/exams/${state.examId}/check`, {
      method: "POST",
      body: JSON.stringify({
        questionId: card.dataset.id,
        answer,
      }),
    });
    if (card.dataset.checkSequence !== String(sequence) || state.submitted) {
      return;
    }
    state.checked.set(card.dataset.id, result);
    applyQuestionFeedback(card, result);
    updateLiveScore();
    updateQuestionNav();
    showNotice("");
  } catch (error) {
    card.classList.remove("checking");
    showNotice(error.message, "error");
  }
}

async function submitExam() {
  if (!state.examId || state.submitted) {
    return;
  }
  const formData = new FormData(els.questionForm);
  const answers = {};
  state.questions.forEach((question) => {
    answers[question.id] = formData.get(question.id) || "";
  });

  try {
    const result = await api(`/api/exams/${state.examId}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
    state.submitted = true;
    renderResults(result);
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function renderResults(result) {
  stopExamTimer();
  const resultMap = new Map(result.results.map((item) => [item.id, item]));
  state.checked = resultMap;
  els.scoreCard.classList.remove("hidden");
  els.scoreValue.textContent = `${result.score}`;
  els.scoreText.textContent = `答对 ${result.correct} / ${result.total}`;

  [...document.querySelectorAll(".question-card")].forEach((card) => {
    const item = resultMap.get(card.dataset.id);
    if (item) {
      applyQuestionFeedback(card, item, { lock: true });
    }
    card.querySelectorAll("[data-action]").forEach((button) => {
      button.disabled = true;
    });
  });
  updateExamStatus();
  updateQuestionNav();
  showQuestion(state.currentIndex);
}

function toggleMark(card = currentCard()) {
  if (!card || state.submitted) {
    return;
  }
  const questionId = card.dataset.id;
  if (state.marked.has(questionId)) {
    state.marked.delete(questionId);
  } else {
    state.marked.add(questionId);
  }
  const markButton = card.querySelector('[data-action="mark"]');
  markButton.textContent = state.marked.has(questionId) ? "取消标记" : "标记题目";
  markButton.classList.toggle("active", state.marked.has(questionId));
  updateQuestionNav();
}

function resetExam() {
  clearCurrentExam();
  setMode("random");
  els.questionCount.value = "30";
  els.shuffleAll.checked = true;
  document.querySelectorAll(".subject-item input").forEach((input) => {
    input.checked = true;
  });
  showNotice("");
}

els.questionForm.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const card = actionButton.closest(".question-card");
    const action = actionButton.dataset.action;
    if (action === "mark") {
      toggleMark(card);
    }
    if (action === "check") {
      checkQuestion(card);
    }
    if (action === "finish") {
      submitExam();
    }
    return;
  }

  const button = event.target.closest(".choice-button");
  if (!button || state.submitted) {
    return;
  }

  const card = button.closest(".question-card");
  const input = card.querySelector(".answer-value");
  const buttons = [...card.querySelectorAll(".choice-button")];
  const mode = card.dataset.answerMode;
  const previousValue = input.value;

  if (mode === "multiple") {
    button.classList.toggle("selected");
    button.setAttribute("aria-pressed", button.classList.contains("selected") ? "true" : "false");
    input.value = buttons
      .filter((item) => item.classList.contains("selected"))
      .map((item) => item.dataset.value)
      .join("");
  } else {
    buttons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    input.value = button.dataset.value;
  }

  if (input.value !== previousValue) {
    clearQuestionFeedback(card);
  }
});

els.questionNav.addEventListener("click", (event) => {
  const button = event.target.closest(".nav-item");
  if (!button) {
    return;
  }
  showQuestion(Number(button.dataset.index));
});

els.refreshBtn.addEventListener("click", loadSubjects);
els.bankMenuButton.addEventListener("click", toggleBankMenu);
els.bankMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-bank-filename]");
  if (!option) {
    return;
  }
  switchBank(option.dataset.bankFilename);
});
document.addEventListener("click", (event) => {
  if (!els.bankDropdown.contains(event.target)) {
    closeBankMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeBankMenu();
  }
});
els.searchBtn.addEventListener("click", searchQuestions);
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchQuestions();
  }
});
els.searchInput.addEventListener("input", () => {
  if (!els.searchInput.value.trim()) {
    clearSearchResults();
  }
});
els.formatUpload.addEventListener("change", (event) => {
  formatQuestionList(event.target.files?.[0]);
});
els.bankUpload.addEventListener("change", (event) => {
  uploadBankFile(event.target.files?.[0]);
});
els.selectAllBtn.addEventListener("click", () => {
  document.querySelectorAll(".subject-item input").forEach((input) => {
    input.checked = true;
  });
});
els.clearAllBtn.addEventListener("click", () => {
  document.querySelectorAll(".subject-item input").forEach((input) => {
    input.checked = false;
  });
});
els.segments.forEach((segment) => {
  segment.addEventListener("click", () => setMode(segment.dataset.mode));
});
els.startBtn.addEventListener("click", startExam);
els.resetBtn.addEventListener("click", resetExam);
els.statusResetBtn.addEventListener("click", resetExam);
window.addEventListener("resize", requestPageScrollSync);

setMode("random");
loadSubjects();
