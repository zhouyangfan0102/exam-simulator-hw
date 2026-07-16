const state = {
  bankName: "题库",
  currentBank: "",
  banks: [],
  subjects: [],
  mode: "random",
  examId: null,
  questions: [],
  answers: new Map(),
  submitted: false,
  checked: new Map(),
  checkRequests: new Map(),
  marked: new Set(),
  currentIndex: 0,
  navFilter: "all",
  navPage: 0,
  navPageSize: 50,
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
  navSummary: document.querySelector("#navSummary"),
  navFilters: document.querySelector("#navFilters"),
  navFilterButtons: [...document.querySelectorAll("[data-nav-filter]")],
  navPrevPage: document.querySelector("#navPrevPage"),
  navNextPage: document.querySelector("#navNextPage"),
  navPageInfo: document.querySelector("#navPageInfo"),
  navJumpForm: document.querySelector("#navJumpForm"),
  navJumpInput: document.querySelector("#navJumpInput"),
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
    const invalid = Boolean(bank.invalid);
    const deleteDisabled = availableBanks.length <= 1;
    const selectTitle = invalid ? `${title}（无法读取：${bank.error || "文件格式不正确"}）` : title;
    const deleteTitle = deleteDisabled ? "至少保留一个题库" : `删除题库：${title}`;
    return `
      <div class="bank-menu-item${selected ? " is-selected" : ""}${invalid ? " is-invalid" : ""}"
        role="option" aria-selected="${selected}">
        <button class="bank-select-option" type="button" data-bank-filename="${escapeHtml(bank.filename)}"
          title="${escapeHtml(selectTitle)}"${invalid ? " disabled" : ""}>
          <span>${escapeHtml(title)}</span>
          <small>${invalid ? "无法读取" : `${Number(bank.total) || 0} 题`}</small>
        </button>
        <button class="bank-delete-button" type="button" data-delete-bank="${escapeHtml(bank.filename)}"
          title="${escapeHtml(deleteTitle)}" aria-label="${escapeHtml(deleteTitle)}"${deleteDisabled ? " disabled" : ""}>×</button>
      </div>
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
  return [...state.answers.values()].filter(Boolean).length;
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
  const source = String(text || "").replace(/\r\n?/g, "\n").trim();
  const candidates = [];
  const addMatches = (pattern, keyGroup, priority, indexOffset = () => 0) => {
    for (const match of source.matchAll(pattern)) {
      const offset = indexOffset(match);
      candidates.push({
        index: match.index + offset,
        end: match.index + match[0].length,
        key: normalizeOptionKey(match[keyGroup]),
        priority,
      });
    }
  };

  addMatches(/[（(\[【]\s*([A-Ha-hＡ-Ｈａ-ｈ])\s*[）)\]】]\s*/g, 1, 3);
  addMatches(/([A-Ha-hＡ-Ｈａ-ｈ])\s*[\.\uFF0E、:：\)）]\s*/g, 1, 2);
  addMatches(
    /(^|[\n\t \u3000]+)([A-Ha-hＡ-Ｈａ-ｈ])[\t \u3000]+(?=\S)/gm,
    2,
    1,
    (match) => match[1].length,
  );

  candidates.sort((left, right) => left.index - right.index
    || right.priority - left.priority
    || (right.end - right.index) - (left.end - left.index));
  const markers = [];
  candidates.forEach((candidate) => {
    if (markers.length && candidate.index < markers[markers.length - 1].end) {
      return;
    }
    markers.push(candidate);
  });

  let optionMarkers = [];
  markers.forEach((marker, startIndex) => {
    if (marker.key !== "A") {
      return;
    }
    let expectedCode = "A".charCodeAt(0);
    const sequence = [];
    for (const candidate of markers.slice(startIndex)) {
      if (candidate.key === "A" && sequence.length) {
        break;
      }
      if (candidate.key === String.fromCharCode(expectedCode)) {
        sequence.push(candidate);
        expectedCode += 1;
      }
    }
    if (sequence.length > optionMarkers.length) {
      optionMarkers = sequence;
    }
  });

  if (optionMarkers.length < 2) {
    return { stem: source, options: [] };
  }

  const options = optionMarkers.map((marker, index) => {
    const next = optionMarkers[index + 1];
    return {
      key: marker.key,
      text: source.slice(marker.end, next ? next.index : source.length).trim(),
    };
  });
  return {
    stem: source.slice(0, optionMarkers[0].index).trim() || source,
    options,
  };
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

async function deleteBank(filename) {
  const bank = state.banks.find((item) => item.filename === filename);
  const title = bankTitle(bank?.name || filename);
  const currentHint = filename === state.currentBank ? "\n删除后将自动切换到其他题库。" : "";
  if (!window.confirm(`确定删除题库“${title}”吗？此操作无法撤销。${currentHint}`)) {
    return;
  }

  els.bankMenuButton.disabled = true;
  closeBankMenu();
  showNotice("正在删除题库...");
  try {
    const data = await api("/api/banks/delete", {
      method: "POST",
      body: JSON.stringify({ filename }),
    });
    clearCurrentExam();
    applyBankData(data);
    clearSearchResults(true);
    showNotice(data.message || "题库删除成功。");
  } catch (error) {
    showNotice(error.message, "error");
    renderBankSelect();
  } finally {
    els.bankMenuButton.disabled = !state.banks.length;
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
  state.answers = new Map();
  state.submitted = false;
  state.checked = new Map();
  state.checkRequests = new Map();
  state.marked = new Set();
  state.currentIndex = 0;
  state.navFilter = "all";
  state.navPage = 0;
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
    state.answers = new Map();
    state.submitted = false;
    state.checked = new Map();
    state.checkRequests = new Map();
    state.marked = new Set();
    state.currentIndex = 0;
    state.navFilter = "all";
    state.navPage = 0;
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
  showQuestion(0);
  updateExamStatus();
  requestPageScrollSync();
}

const navFilterLabels = {
  all: "全部",
  unanswered: "未答",
  correct: "正确",
  wrong: "错误",
  marked: "标记",
};

function questionMatchesNavFilter(question, filter) {
  const answer = state.answers.get(question.id) || "";
  const result = state.checked.get(question.id);
  if (filter === "unanswered") {
    return !answer;
  }
  if (filter === "correct") {
    return Boolean(result?.correct);
  }
  if (filter === "wrong") {
    return Boolean(result && !result.correct);
  }
  if (filter === "marked") {
    return state.marked.has(question.id);
  }
  return true;
}

function filteredQuestionIndices() {
  const indices = [];
  state.questions.forEach((question, index) => {
    if (questionMatchesNavFilter(question, state.navFilter)) {
      indices.push(index);
    }
  });
  return indices;
}

function updateNavFilterCounts() {
  const counts = {
    all: state.questions.length,
    unanswered: 0,
    correct: 0,
    wrong: 0,
    marked: state.marked.size,
  };
  state.questions.forEach((question) => {
    if (!(state.answers.get(question.id) || "")) {
      counts.unanswered += 1;
    }
    const result = state.checked.get(question.id);
    if (result?.correct) {
      counts.correct += 1;
    } else if (result) {
      counts.wrong += 1;
    }
  });
  els.navFilterButtons.forEach((button) => {
    const filter = button.dataset.navFilter;
    button.classList.toggle("active", filter === state.navFilter);
    button.setAttribute("aria-pressed", String(filter === state.navFilter));
    const count = button.querySelector("small");
    if (count) {
      count.textContent = String(counts[filter] || 0);
    }
  });
}

function renderQuestionNav() {
  els.questionNav.innerHTML = "";
  updateNavFilterCounts();
  const indices = filteredQuestionIndices();
  const pageCount = Math.ceil(indices.length / state.navPageSize);
  state.navPage = Math.max(0, Math.min(state.navPage, Math.max(0, pageCount - 1)));
  const pageStart = state.navPage * state.navPageSize;
  const pageIndices = indices.slice(pageStart, pageStart + state.navPageSize);

  pageIndices.forEach((index) => {
    const question = state.questions[index];
    const button = document.createElement("button");
    button.className = "nav-item";
    button.type = "button";
    button.dataset.index = String(index);
    button.dataset.id = question.id;
    const number = String(index + 1);
    button.dataset.digits = String(number.length);
    button.textContent = number;
    button.title = `${index + 1}. ${question.subject} ${question.type}`;
    const result = state.checked.get(question.id);
    button.classList.toggle("current", index === state.currentIndex);
    if (index === state.currentIndex) {
      button.setAttribute("aria-current", "step");
    }
    button.classList.toggle("marked", state.marked.has(question.id));
    button.classList.toggle("correct", Boolean(result?.correct));
    button.classList.toggle("wrong", Boolean(result && !result.correct));
    els.questionNav.appendChild(button);
  });

  if (!pageIndices.length) {
    const empty = document.createElement("p");
    empty.className = "nav-empty";
    empty.textContent = "此状态暂无题目";
    els.questionNav.appendChild(empty);
  }

  const firstNumber = pageIndices.length ? pageIndices[0] + 1 : 0;
  const lastNumber = pageIndices.length ? pageIndices[pageIndices.length - 1] + 1 : 0;
  const label = navFilterLabels[state.navFilter] || "全部";
  els.navSummary.textContent = state.navFilter === "all" && pageIndices.length
    ? `${firstNumber}-${lastNumber} / ${indices.length}`
    : `${label} ${indices.length}${pageIndices.length ? ` / 本组 ${pageIndices.length}` : ""}`;
  els.navPageInfo.textContent = pageCount ? `${state.navPage + 1} / ${pageCount}` : "0 / 0";
  els.navPrevPage.disabled = state.navPage <= 0;
  els.navNextPage.disabled = !pageCount || state.navPage >= pageCount - 1;
  els.navJumpInput.max = String(state.questions.length || 1);
}

function updateQuestionNav() {
  renderQuestionNav();
}

function renderCurrentQuestion() {
  const question = state.questions[state.currentIndex];
  els.questionForm.innerHTML = "";
  if (!question) {
    return;
  }
  const prepared = prepareQuestion(question);
  const card = document.createElement("article");
  card.className = "question-card";
  card.dataset.id = question.id;
  card.dataset.index = String(state.currentIndex);
  card.dataset.answerMode = prepared.mode;
  card.innerHTML = `
    <div class="question-head">
      <div class="question-meta">
        <span class="index-badge">${state.currentIndex + 1}</span>
        <span class="type-badge">${escapeHtml(question.type || "未分类")}</span>
        <span class="subject-badge" title="${escapeHtml(question.subject)}">${escapeHtml(question.subject)}</span>
      </div>
      <span class="result-badge hidden"></span>
    </div>
    <p class="question-text">${escapeHtml(prepared.stem)}</p>
    <input class="answer-value" type="hidden" />
    ${renderChoiceButtons(prepared)}
    <div class="answer-review hidden"></div>
    <div class="question-controls">
      <div class="question-pagination" aria-label="题目翻页">
        <button class="question-page-button" data-action="previous" type="button" title="上一题（← / ↑）" aria-label="上一题" aria-keyshortcuts="ArrowLeft ArrowUp">
          <span aria-hidden="true">‹</span><span class="page-button-label">上一题</span>
        </button>
        <span class="question-position" aria-live="polite" aria-atomic="true">${state.currentIndex + 1} / ${state.questions.length}</span>
        <button class="question-page-button" data-action="next" type="button" title="下一题（→ / ↓）" aria-label="下一题" aria-keyshortcuts="ArrowRight ArrowDown">
          <span class="page-button-label">下一题</span><span aria-hidden="true">›</span>
        </button>
      </div>
      <div class="question-actions">
        <button class="mark-button" data-action="mark" type="button" aria-label="标记题目">
          <span class="action-label-full">标记题目</span><span class="action-label-short" aria-hidden="true">标记</span>
        </button>
        <button class="submit-answer-button" data-action="check" type="button" aria-label="提交答案">
          <span class="action-label-full">提交答案</span><span class="action-label-short" aria-hidden="true">提交</span>
        </button>
        <button class="finish-button" data-action="finish" type="button">交卷</button>
      </div>
    </div>
  `;
  els.questionForm.appendChild(card);

  const answer = state.answers.get(question.id) || "";
  card.querySelector(".answer-value").value = answer;
  const selectedKeys = new Set(answerKeys(answer, prepared.mode));
  card.querySelectorAll(".choice-button").forEach((button) => {
    const selected = selectedKeys.has(button.dataset.value);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  const marked = state.marked.has(question.id);
  const markButton = card.querySelector('[data-action="mark"]');
  markButton.querySelector(".action-label-full").textContent = marked ? "取消标记" : "标记题目";
  markButton.querySelector(".action-label-short").textContent = marked ? "取消" : "标记";
  markButton.setAttribute("aria-label", marked ? "取消标记" : "标记题目");
  markButton.classList.toggle("active", marked);
  card.querySelector('[data-action="previous"]').disabled = state.currentIndex === 0;
  card.querySelector('[data-action="next"]').disabled = state.currentIndex === state.questions.length - 1;

  const result = state.checked.get(question.id);
  if (result) {
    applyQuestionFeedback(card, result, { lock: state.submitted });
  }
  if (state.submitted) {
    card.querySelectorAll('[data-action="mark"], [data-action="check"], [data-action="finish"]').forEach((button) => {
      button.disabled = true;
    });
  }
}

function showQuestion(index, { preserveScroll = true, revealInNav = true } = {}) {
  if (index < 0 || index >= state.questions.length) {
    return;
  }
  const scrollLeft = window.scrollX;
  const scrollTop = window.scrollY;
  state.currentIndex = index;
  let indices = filteredQuestionIndices();
  let position = indices.indexOf(index);
  if (revealInNav && position < 0) {
    state.navFilter = "all";
    indices = filteredQuestionIndices();
    position = index;
  }
  if (position >= 0) {
    state.navPage = Math.floor(position / state.navPageSize);
  }
  renderCurrentQuestion();
  renderQuestionNav();
  if (preserveScroll) {
    requestAnimationFrame(() => {
      window.scrollTo(scrollLeft, scrollTop);
    });
  }
}

function currentCard() {
  return els.questionForm.querySelector(".question-card");
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
  state.checkRequests.delete(card.dataset.id);
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
  const questionId = card.dataset.id;
  const answer = state.answers.get(questionId) || "";
  if (!answer) {
    showNotice("请先选择答案，再提交本题。");
    return;
  }

  const sequence = (state.checkRequests.get(questionId) || 0) + 1;
  state.checkRequests.set(questionId, sequence);
  const examId = state.examId;
  card.classList.add("checking");

  try {
    const result = await api(`/api/exams/${examId}/check`, {
      method: "POST",
      body: JSON.stringify({
        questionId,
        answer,
      }),
    });
    if (
      state.examId !== examId
      || state.checkRequests.get(questionId) !== sequence
      || state.answers.get(questionId) !== answer
      || state.submitted
    ) {
      return;
    }
    state.checked.set(questionId, result);
    const visibleCard = currentCard();
    if (visibleCard?.dataset.id === questionId) {
      applyQuestionFeedback(visibleCard, result);
    }
    updateLiveScore();
    updateQuestionNav();
    showNotice("");
  } catch (error) {
    const visibleCard = currentCard();
    if (visibleCard?.dataset.id === questionId) {
      visibleCard.classList.remove("checking");
    }
    showNotice(error.message, "error");
  } finally {
    if (state.checkRequests.get(questionId) === sequence) {
      state.checkRequests.delete(questionId);
    }
  }
}

async function submitExam() {
  if (!state.examId || state.submitted) {
    return;
  }
  const answers = Object.fromEntries(state.answers);

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
  updateExamStatus();
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
  const marked = state.marked.has(questionId);
  markButton.querySelector(".action-label-full").textContent = marked ? "取消标记" : "标记题目";
  markButton.querySelector(".action-label-short").textContent = marked ? "取消" : "标记";
  markButton.setAttribute("aria-label", marked ? "取消标记" : "标记题目");
  markButton.classList.toggle("active", marked);
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
    if (action === "previous") {
      showQuestion(state.currentIndex - 1);
    }
    if (action === "next") {
      showQuestion(state.currentIndex + 1);
    }
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
    if (input.value) {
      state.answers.set(card.dataset.id, input.value);
    } else {
      state.answers.delete(card.dataset.id);
    }
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

els.navFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-nav-filter]");
  if (!button) {
    return;
  }
  state.navFilter = button.dataset.navFilter;
  const indices = filteredQuestionIndices();
  const currentPosition = indices.indexOf(state.currentIndex);
  if (indices.length && currentPosition < 0) {
    showQuestion(indices[0], { revealInNav: false });
    return;
  }
  state.navPage = currentPosition >= 0 ? Math.floor(currentPosition / state.navPageSize) : 0;
  renderQuestionNav();
});

els.navPrevPage.addEventListener("click", () => {
  if (state.navPage <= 0) {
    return;
  }
  const indices = filteredQuestionIndices();
  const target = indices[(state.navPage - 1) * state.navPageSize];
  if (target !== undefined) {
    showQuestion(target, { revealInNav: false });
  }
});

els.navNextPage.addEventListener("click", () => {
  const indices = filteredQuestionIndices();
  const target = indices[(state.navPage + 1) * state.navPageSize];
  if (target !== undefined) {
    showQuestion(target, { revealInNav: false });
  }
});

els.navJumpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const number = Number(els.navJumpInput.value);
  if (!Number.isInteger(number) || number < 1 || number > state.questions.length) {
    showNotice(`请输入 1-${state.questions.length} 之间的题号。`);
    els.navJumpInput.focus();
    return;
  }
  showNotice("");
  showQuestion(number - 1);
  els.navJumpInput.select();
});

els.refreshBtn.addEventListener("click", loadSubjects);
els.bankMenuButton.addEventListener("click", toggleBankMenu);
els.bankMenu.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-bank]");
  if (deleteButton) {
    deleteBank(deleteButton.dataset.deleteBank);
    return;
  }
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
const questionNavigationOffsets = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeBankMenu();
    return;
  }

  const offset = questionNavigationOffsets[event.key];
  if (!offset || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) {
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) {
    return;
  }
  if (!state.questions.length || els.examLayout.classList.contains("hidden")) {
    return;
  }
  event.preventDefault();
  showQuestion(state.currentIndex + offset);
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
