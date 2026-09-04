const appApi = window.typeTranslate;

const state = {
  config: null,
  status: null,
  provider: "ollama",
  page: "home",
  autoLanguage: "ja",
  lastRuntimeMessage: "",
  toastTimer: null,
  pendingAuto: null,
  pendingSelectionPopup: null,
  lockedTarget: localStorage.getItem("relay.targetApp") || "",
  quickRequestId: "",
  preferences: null,
  secret: { hasKey: false, fromEnvironment: false },
  setupProvider: "ollama",
  setupDismissed: false,
  targetMenuOpen: false,
  historyOpen: false,
  history: [],
  clearHistoryArmed: false,
};

const pageNames = {
  home: "Translation",
  voice: "Settings",
  settings: "Settings",
};

const enhancedSelects = new Map();
let openSelect = null;

function byId(id) {
  return document.getElementById(id);
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function setSwitch(element, enabled) {
  element.classList.toggle("on", enabled);
  element.setAttribute("aria-checked", String(enabled));
}

function selectedLabel(select) {
  return select.selectedOptions[0]?.textContent || "Choose";
}

function selectContext(select) {
  return select.getAttribute("aria-label")
    || select.closest(".field")?.querySelector(":scope > span")?.textContent
    || select.closest(".setting-row")?.querySelector(":scope > span")?.textContent
    || select.closest(".tone-row")?.querySelector("strong")?.textContent
    || "Selection";
}

function closeSelect(focusButton = false) {
  if (!openSelect) return;
  const entry = enhancedSelects.get(openSelect);
  entry.menu.hidden = true;
  entry.button.classList.remove("open");
  entry.button.setAttribute("aria-expanded", "false");
  if (focusButton) entry.button.focus();
  openSelect = null;
}

function positionSelectMenu(entry) {
  const rect = entry.button.getBoundingClientRect();
  const width = Math.max(rect.width, 176);
  entry.menu.style.width = width + "px";
  entry.menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px";
  const menuHeight = entry.menu.offsetHeight;
  const top = rect.bottom + 6 + menuHeight > window.innerHeight - 8
    ? Math.max(8, rect.top - menuHeight - 6)
    : rect.bottom + 6;
  entry.menu.style.top = top + "px";
}

function syncSelectControl(select) {
  const entry = enhancedSelects.get(select);
  if (!entry) return;
  const label = selectedLabel(select);
  entry.value.textContent = label;
  entry.button.setAttribute("aria-label", entry.context + ": " + label);
  entry.button.disabled = select.disabled || select.options.length < 2;
  entry.options.forEach((optionButton) => {
    const selected = optionButton.dataset.value === select.value;
    optionButton.classList.toggle("selected", selected);
    optionButton.setAttribute("aria-selected", String(selected));
  });
}

function syncSelectControls() {
  enhancedSelects.forEach((_, select) => syncSelectControl(select));
}

function openSelectControl(select) {
  const entry = enhancedSelects.get(select);
  if (!entry || entry.button.disabled) return;
  closeTargetMenu();
  if (openSelect === select) {
    closeSelect();
    return;
  }
  closeSelect();
  openSelect = select;
  entry.menu.hidden = false;
  entry.button.classList.add("open");
  entry.button.setAttribute("aria-expanded", "true");
  positionSelectMenu(entry);
  const selected = entry.options.find((option) => option.classList.contains("selected")) || entry.options[0];
  selected?.focus();
}

function chooseSelectOption(select, value) {
  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  syncSelectControl(select);
  closeSelect(true);
}

function enhanceSelects() {
  document.querySelectorAll("select").forEach((select, index) => {
    const wrapper = document.createElement("span");
    wrapper.className = "custom-select";
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add("select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const menuId = "select-menu-" + (select.id || index);
    button.setAttribute("aria-controls", menuId);

    const value = document.createElement("span");
    value.className = "select-value";
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("viewBox", "0 0 12 12");
    chevron.setAttribute("aria-hidden", "true");
    const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    chevronPath.setAttribute("d", "m3 4.75 3 3 3-3");
    chevron.appendChild(chevronPath);
    button.append(value, chevron);
    wrapper.appendChild(button);

    const menu = document.createElement("div");
    menu.id = menuId;
    menu.className = "select-popover";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    const optionButtons = Array.from(select.options).map((option) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "select-option";
      optionButton.dataset.value = option.value;
      optionButton.setAttribute("role", "option");
      const label = document.createElement("span");
      label.textContent = option.textContent;
      const check = document.createElement("span");
      check.className = "select-check";
      check.textContent = "✓";
      optionButton.append(label, check);
      optionButton.addEventListener("click", () => chooseSelectOption(select, option.value));
      return optionButton;
    });
    menu.append(...optionButtons);
    document.body.appendChild(menu);

    const context = selectContext(select);
    menu.setAttribute("aria-label", context);
    enhancedSelects.set(select, { wrapper, button, value, menu, options: optionButtons, context });
    button.addEventListener("click", () => openSelectControl(select));
    button.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openSelectControl(select);
      }
    });
    menu.addEventListener("keydown", (event) => {
      const current = optionButtons.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeSelect(true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        optionButtons[(current + step + optionButtons.length) % optionButtons.length].focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        optionButtons[event.key === "Home" ? 0 : optionButtons.length - 1].focus();
      } else if (event.key === "Tab") {
        closeSelect();
      }
    });
    select.addEventListener("change", () => syncSelectControl(select));
    syncSelectControl(select);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!openSelect) return;
    const entry = enhancedSelects.get(openSelect);
    if (!entry.button.contains(event.target) && !entry.menu.contains(event.target)) closeSelect();
  });
  window.addEventListener("resize", () => closeSelect());
  document.querySelector(".main").addEventListener("scroll", () => closeSelect());
}

function showToast(message, error = false) {
  const toast = byId("toast");
  byId("toastText").textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

async function request(path, method = "GET", body, timeout, id = "") {
  return appApi.request({ path, method, body, timeout, id });
}

function savedAppProfiles() {
  try {
    const profiles = JSON.parse(localStorage.getItem("relay.appProfiles") || "{}");
    const legacy = JSON.parse(localStorage.getItem("relay.appLanguages") || "{}");
    Object.entries(legacy).forEach(([processName, language]) => {
      if (!profiles[processName]) profiles[processName] = { language };
    });
    return profiles;
  } catch {
    return {};
  }
}

function rememberProfile(processName, patch) {
  if (!processName) return;
  const values = savedAppProfiles();
  const key = processName.toLowerCase();
  values[key] = { ...(values[key] || {}), ...patch };
  localStorage.setItem("relay.appProfiles", JSON.stringify(values));
}

function recentTargets() {
  try {
    return JSON.parse(localStorage.getItem("relay.recentApps") || "[]");
  } catch {
    return [];
  }
}

function rememberTarget(processName) {
  if (!processName) return;
  const recent = [processName, ...recentTargets().filter((item) => item.toLowerCase() !== processName.toLowerCase())].slice(0, 5);
  localStorage.setItem("relay.recentApps", JSON.stringify(recent));
}

function closeTargetMenu() {
  state.targetMenuOpen = false;
  setHidden(byId("targetMenu"), true);
  byId("targetMenuButton").classList.remove("open");
  byId("targetMenuButton").setAttribute("aria-expanded", "false");
}

function renderTargetMenu() {
  const list = byId("targetAppOptions");
  list.replaceChildren();
  const targets = recentTargets();
  if (!targets.length) {
    const empty = document.createElement("span");
    empty.className = "target-menu-empty";
    empty.textContent = "No recent apps yet";
    list.appendChild(empty);
  }
  targets.forEach((processName) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = friendlyProcess(processName);
    button.classList.toggle("selected", processName.toLowerCase() === state.lockedTarget.toLowerCase());
    button.addEventListener("click", () => lockTarget(processName));
    list.appendChild(button);
  });
  const current = state.status?.runtime?.targetProc || "";
  byId("useCurrentAppButton").disabled = !current;
  byId("useCurrentAppButton").textContent = current ? "Use current app · " + friendlyProcess(current) : "Open another app first";
}

function registerForTone(language, tone) {
  const values = {
    ko: { casual: "banmal", friendly: "haeyo", formal: "formal" },
    ja: { casual: "tameguchi", friendly: "teineigo", formal: "keigo" },
    fr: { casual: "tu_familier", friendly: "tu_neutre", formal: "vous" },
  };
  return values[language]?.[tone] || values[language]?.casual;
}

function toneForRegister(language, register) {
  const values = {
    ko: { banmal: "casual", haeyo: "friendly", formal: "formal" },
    ja: { tameguchi: "casual", teineigo: "friendly", keigo: "formal" },
    fr: { tu_familier: "casual", tu_neutre: "friendly", vous: "formal" },
  };
  return values[language]?.[register] || "casual";
}

function applyTone(tone) {
  const field = byId("register" + state.autoLanguage.charAt(0).toUpperCase() + state.autoLanguage.slice(1));
  if (field) field.value = registerForTone(state.autoLanguage, tone);
}

function autoCommand() {
  return state.lockedTarget
    ? { action: "auto-target", value: state.autoLanguage + "|" + state.lockedTarget }
    : { action: "auto", value: state.autoLanguage };
}

async function saveBehaviorPatch(patch) {
  if (!state.config) return false;
  const previous = { ...(state.config.behavior || {}) };
  state.config.behavior = { ...(state.config.behavior || {}), ...patch };
  try {
    state.config = await request("/api/config", "PUT", configFromForm(), 8000);
    return true;
  } catch (error) {
    state.config.behavior = previous;
    showToast(error.message || "Couldn’t save that setting", true);
    return false;
  }
}

function setPage(page) {
  if (!pageNames[page]) return;
  closeHistory();
  closeSelect();
  closeTargetMenu();
  state.page = page;
  document.querySelectorAll(".settings-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });
  document.querySelectorAll(".page").forEach((item) => {
    item.classList.toggle("active", item.id === "page-" + page);
  });
  byId("settingsButton").classList.toggle("active", page !== "home");
  document.title = page === "home" ? "Relay" : pageNames[page] + " — Relay";
  document.querySelector(".main").scrollTop = 0;
}

function setStatusMark(element, status) {
  element.classList.remove("ready", "error", "checking");
  element.classList.add(status);
}

function friendlyProcess(name) {
  if (!name) return "";
  const value = name.replace(/\.exe$/i, "").replace(/[-_]+/g, " ");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function languageName(language) {
  return { ko: "Korean", ja: "Japanese", fr: "French", en: "English" }[language] || language;
}

function blockedApp(processName) {
  return new Set([
    "windowsterminal.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe",
    "mintty.exe", "bash.exe", "wsl.exe", "ssh.exe", "1password.exe", "bitwarden.exe",
    "keepass.exe", "keepassxc.exe", "credentialuibroker.exe",
  ]).has(String(processName || "").toLowerCase());
}

function currentAllowedApps() {
  const apps = state.config?.behavior?.allowedApps;
  return Array.isArray(apps) ? apps : [];
}

function renderAllowedApps() {
  const list = byId("allowedAppList");
  if (!list) return;
  list.replaceChildren();
  const apps = currentAllowedApps();
  if (!apps.length) {
    const empty = document.createElement("div");
    empty.className = "allowed-app-empty";
    empty.textContent = "Choose an app from Auto Translate to allow it.";
    list.appendChild(empty);
    return;
  }
  apps.forEach((processName) => {
    const row = document.createElement("div");
    row.className = "allowed-app-row";
    const name = document.createElement("strong");
    name.textContent = friendlyProcess(processName);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeAllowedApp(processName));
    row.append(name, remove);
    list.appendChild(row);
  });
}

async function syncSafetyApps() {
  return sendControl("safety-apps", currentAllowedApps().join("|"));
}

async function ensureAllowedApp(processName) {
  if (!processName || blockedApp(processName)) return false;
  const apps = currentAllowedApps();
  if (!apps.some((item) => item.toLowerCase() === processName.toLowerCase())) {
    if (!await saveBehaviorPatch({ allowedApps: [...apps, processName].slice(0, 30) })) return false;
    renderAllowedApps();
  }
  await syncSafetyApps();
  return true;
}

async function removeAllowedApp(processName) {
  const apps = currentAllowedApps().filter((item) => item.toLowerCase() !== processName.toLowerCase());
  if (!await saveBehaviorPatch({ allowedApps: apps })) return;
  if (state.status?.runtime?.autoProc?.toLowerCase() === processName.toLowerCase()) {
    state.pendingAuto = { enabled: false, language: state.autoLanguage, until: Date.now() + 5000 };
    await sendControl("auto-off");
  }
  if (state.lockedTarget.toLowerCase() === processName.toLowerCase()) {
    state.lockedTarget = "";
    localStorage.removeItem("relay.targetApp");
  }
  await syncSafetyApps();
  renderAllowedApps();
  if (state.status) renderStatus(state.status);
  showToast(friendlyProcess(processName) + " removed from Auto Translate");
}

function historyTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function closeHistory() {
  state.historyOpen = false;
  byId("historyPanel")?.classList.add("hidden");
  byId("historyScrim")?.classList.add("hidden");
  byId("historyButton")?.classList.remove("active");
}

function openHistory() {
  state.historyOpen = true;
  byId("historyPanel").classList.remove("hidden");
  byId("historyScrim").classList.remove("hidden");
  byId("historyButton").classList.add("active");
  loadHistory();
  setTimeout(() => byId("closeHistoryButton").focus(), 0);
}

function useHistoryItem(item) {
  byId("quickInput").value = item.source;
  if (["ko", "ja", "fr", "en"].includes(item.target)) byId("quickTarget").value = item.target;
  byId("quickSource").value = "auto";
  byId("quickOutput").textContent = item.translation;
  byId("quickOutput").classList.remove("placeholder");
  byId("characterCount").textContent = item.source.length + " / 2000";
  setHidden(byId("copyOutputButton"), false);
  syncSelectControls();
  closeHistory();
  byId("quickInput").focus();
}

function renderHistory(result) {
  state.history = Array.isArray(result?.items) ? result.items : [];
  const count = byId("historyCount");
  count.textContent = state.history.length > 99 ? "99+" : String(state.history.length);
  setHidden(count, !state.history.length);
  byId("historyPrivacyText").textContent = result?.enabled === false ? "History is off" : "Up to 100 translations";
  const list = byId("historyList");
  list.replaceChildren();
  if (result?.enabled === false || !state.history.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    const title = document.createElement("strong");
    title.textContent = result?.enabled === false ? "History is off" : "Nothing here yet";
    const detail = document.createElement("span");
    detail.textContent = result?.enabled === false
      ? "Turn it on in Settings when you want Relay to remember translations."
      : "Translations from Quick Translate, shortcuts, and Auto Translate will appear here.";
    empty.append(title, detail);
    list.appendChild(empty);
    return;
  }
  state.history.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item";
    const meta = document.createElement("div");
    meta.className = "history-meta";
    const context = document.createElement("span");
    const appName = item.app && item.app !== "Relay" ? " · " + friendlyProcess(item.app) : "";
    context.textContent = languageName(item.target) + appName;
    const time = document.createElement("time");
    time.dateTime = item.createdAt || "";
    time.textContent = historyTime(item.createdAt);
    meta.append(context, time);
    const source = document.createElement("p");
    source.className = "history-source";
    source.textContent = item.source;
    const translation = document.createElement("p");
    translation.className = "history-translation";
    translation.textContent = item.translation;
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      await appApi.copy(item.translation);
      showToast("Translation copied");
    });
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "Use again";
    use.addEventListener("click", () => useHistoryItem(item));
    actions.append(copy, use);
    row.append(meta, source, translation, actions);
    list.appendChild(row);
  });
}

async function loadHistory() {
  try {
    renderHistory(await request("/api/history", "GET", undefined, 4000));
  } catch {
    if (state.historyOpen) renderHistory({ enabled: true, items: [] });
  }
}

function renderStatus(status) {
  state.status = status;
  const backend = status.backend || { state: "checking", message: "Connecting…" };
  const runtime = status.runtime || {};
  const statusState = backend.state === "ready" ? "ready" : backend.state === "error" ? "error" : "checking";
  const providerName = status.provider === "anthropic" ? "Anthropic" : "Ollama";

  setStatusMark(byId("headerStatusDot"), statusState);
  byId("headerStatusText").textContent = statusState === "ready"
    ? providerName + (status.model ? " · " + status.model : "")
    : statusState === "error" ? "Engine needs attention" : "Starting engine";

  const connection = byId("connectionText");
  connection.textContent = backend.message || "Checking connection…";
  connection.classList.remove("ready", "error", "checking");
  connection.classList.add(statusState);

  const target = friendlyProcess(runtime.targetProc);
  const lockedTarget = friendlyProcess(state.lockedTarget);
  const runtimeAuto = Boolean(runtime.autoLang);
  const configuredSelectionPopup = state.config?.behavior?.selectionPopupEnabled !== false;
  const runtimeSelectionPopup = typeof runtime.selectionPopupEnabled === "boolean"
    ? runtime.selectionPopupEnabled
    : configuredSelectionPopup;
  const newMessage = runtime.message && runtime.message !== state.lastRuntimeMessage;

  if (state.pendingAuto) {
    const confirmed = runtimeAuto === state.pendingAuto.enabled
      && (!state.pendingAuto.enabled || runtime.autoLang === state.pendingAuto.language);
    if (confirmed) {
      state.pendingAuto = null;
    } else if (Date.now() > state.pendingAuto.until) {
      const wasTurningOn = state.pendingAuto.enabled;
      state.pendingAuto = null;
      if (wasTurningOn) showToast("Auto Translate couldn’t start. Reopen Relay and try again.", true);
    }
  }
  if (runtime.autoLang && !state.pendingAuto) {
    state.autoLanguage = runtime.autoLang;
    byId("autoLanguageSelect").value = runtime.autoLang;
    const profile = savedAppProfiles()[state.lockedTarget.toLowerCase()] || {};
    const register = state.config?.profiles?.[runtime.autoLang]?.register;
    byId("autoToneSelect").value = profile.tone || toneForRegister(runtime.autoLang, register);
  }
  syncSelectControls();
  const autoEnabled = state.pendingAuto?.enabled ?? runtimeAuto;
  setSwitch(byId("autoSwitch"), autoEnabled);
  if (state.pendingSelectionPopup) {
    if (runtimeSelectionPopup === state.pendingSelectionPopup.enabled) {
      state.pendingSelectionPopup = null;
    } else if (Date.now() > state.pendingSelectionPopup.until) {
      state.pendingSelectionPopup = null;
      showToast("The highlight popup couldn’t connect. Reopen Relay and try again.", true);
    }
  }
  const selectionPopupEnabled = state.pendingSelectionPopup?.enabled ?? runtimeSelectionPopup;
  setSwitch(byId("selectionPopupSwitch"), selectionPopupEnabled);
  byId("selectionPopupSwitch").disabled = Boolean(state.pendingSelectionPopup);
  byId("sessionControl").classList.toggle("on", autoEnabled);
  byId("sessionControl").classList.toggle("paused", Boolean(runtime.safetyPaused));
  byId("targetAppName").textContent = lockedTarget || (target ? "Use " + target : "Choose an app");
  if (!state.targetMenuOpen) renderTargetMenu();
  byId("targetAppText").textContent = runtime.safetyPaused
    ? "Paused — " + (runtime.safetyReason || "Relay will not change text in this field") + "."
    : runtime.previewReady
    ? "Draft ready in " + (friendlyProcess(runtime.autoProc) || lockedTarget || target) + " — Enter sends, Esc restores."
    : !runtime.helperConnected
    ? "Typing helper is reconnecting…"
    : state.pendingAuto
      ? state.pendingAuto.enabled ? "Turning on for " + (lockedTarget || target || "the current app") + "…" : "Turning auto translate off…"
      : runtimeAuto ? "Sending through " + (friendlyProcess(runtime.autoProc) || lockedTarget || target) + "."
        : lockedTarget ? "Relay will send through " + lockedTarget + "."
          : target ? "Use " + target + " to keep Relay from switching apps by accident."
            : "Open the app you want to type in, then come back here.";

  if (byId("setupOverlay") && !byId("setupOverlay").classList.contains("hidden")) {
    renderSetupStatus();
  }

  if (runtime.message && runtime.message !== state.lastRuntimeMessage) {
    state.lastRuntimeMessage = runtime.message;
    showToast(runtime.message, /error|failed|couldn/i.test(runtime.message));
  }
}

function renderDisconnected() {
  setStatusMark(byId("headerStatusDot"), "checking");
  byId("headerStatusText").textContent = "Starting engine";
  const connection = byId("connectionText");
  connection.textContent = "Waiting for the translation service…";
  connection.className = "connection-state checking";
}

async function refreshStatus() {
  try {
    renderStatus(await request("/api/status", "GET", undefined, 3000));
  } catch {
    renderDisconnected();
  } finally {
    setTimeout(refreshStatus, 900);
  }
}

function renderProvider() {
  document.querySelectorAll(".provider-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.provider === state.provider);
  });
  setHidden(byId("ollamaSettings"), state.provider !== "ollama");
  setHidden(byId("anthropicSettings"), state.provider !== "anthropic");
}

function renderConfig(config) {
  state.config = config;
  state.provider = config.provider || "ollama";
  byId("voiceName").value = config.you?.name || "me";
  byId("speechStyle").value = config.you?.speech || "masculine-neutral";
  byId("styleNotes").value = (config.you?.style || []).join("\n");
  byId("registerKo").value = config.profiles?.ko?.register || "banmal";
  byId("registerJa").value = config.profiles?.ja?.register || "tameguchi";
  byId("registerFr").value = config.profiles?.fr?.register || "tu_familier";
  byId("ollamaModel").value = config.providers?.ollama?.model || "translategemma:4b";
  byId("ollamaHost").value = config.providers?.ollama?.host || "http://127.0.0.1:11434";
  byId("anthropicModel").value = config.providers?.anthropic?.model || "claude-opus-5";
  byId("anthropicEffort").value = config.providers?.anthropic?.effort || "low";
  byId("sendModeSelect").value = config.behavior?.sendMode || "instant";
  const appProfile = savedAppProfiles()[state.lockedTarget.toLowerCase()] || {};
  if (["ko", "ja", "fr"].includes(appProfile.language)) state.autoLanguage = appProfile.language;
  byId("autoLanguageSelect").value = state.autoLanguage;
  if (["instant", "review"].includes(appProfile.sendMode)) byId("sendModeSelect").value = appProfile.sendMode;
  const register = config.profiles?.[state.autoLanguage]?.register;
  byId("autoToneSelect").value = appProfile.tone || toneForRegister(state.autoLanguage, register);
  applyTone(byId("autoToneSelect").value);
  if (byId("themeSelect")) byId("themeSelect").value = config.behavior?.theme || "system";
  setSwitch(byId("selectionPopupSwitch"), config.behavior?.selectionPopupEnabled !== false);
  setSwitch(byId("historySwitch"), config.behavior?.historyEnabled !== false);
  renderAllowedApps();
  renderKeyState();
  renderProvider();
  syncSelectControls();
}

function renderKeyState() {
  const label = byId("keyState");
  const remove = byId("removeKeyButton");
  if (!label) return;

  if (state.secret.fromEnvironment) {
    label.textContent = "Using ANTHROPIC_API_KEY from Windows";
    setHidden(remove, true);
  } else if (state.secret.hasKey) {
    label.textContent = "Protected by Windows";
    setHidden(remove, false);
  } else {
    label.textContent = "No key yet";
    setHidden(remove, true);
  }
}

async function refreshSecretStatus() {
  try {
    state.secret = await appApi.getSecretStatus();
    renderKeyState();
  } catch {}
}

async function loadConfig() {
  try {
    let config = await request("/api/config", "GET", undefined, 5000);
    renderConfig(config);
    const apps = config.behavior?.allowedApps || [];
    if (state.lockedTarget && !apps.some((item) => item.toLowerCase() === state.lockedTarget.toLowerCase())) {
      config.behavior = { ...(config.behavior || {}), allowedApps: [...apps, state.lockedTarget] };
      state.config = config;
      config = await request("/api/config", "PUT", configFromForm(), 8000);
      renderConfig(config);
    }
    await sendControl("safety-apps", (config.behavior?.allowedApps || []).join("|"));
    await sendControl("send-mode", byId("sendModeSelect").value);
    await sendControl("selection-popup", String(config.behavior?.selectionPopupEnabled !== false));
    loadHistory();
    if (!config.behavior?.onboardingComplete) setTimeout(() => showSetup(), 180);
  } catch {
    setTimeout(loadConfig, 900);
  }
}

function configFromForm() {
  const current = state.config || {};
  return {
    ...current,
    provider: state.provider,
    you: {
      ...(current.you || {}),
      name: byId("voiceName").value.trim() || "me",
      speech: byId("speechStyle").value,
      style: byId("styleNotes").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    },
    providers: {
      ...(current.providers || {}),
      ollama: {
        ...(current.providers?.ollama || {}),
        model: byId("ollamaModel").value.trim(),
        host: byId("ollamaHost").value.trim(),
      },
      anthropic: {
        ...(current.providers?.anthropic || {}),
        model: byId("anthropicModel").value.trim(),
        effort: byId("anthropicEffort").value,
      },
    },
    behavior: {
      ...(current.behavior || {}),
      theme: byId("themeSelect")?.value || current.behavior?.theme || "system",
      sendMode: byId("sendModeSelect").value,
      openShortcut: byId("shortcutSelect")?.value || current.behavior?.openShortcut || "Control+Alt+T",
      lastLanguage: state.autoLanguage,
      selectionPopupEnabled: byId("selectionPopupSwitch")?.getAttribute("aria-checked") !== "false",
      historyEnabled: byId("historySwitch")?.getAttribute("aria-checked") !== "false",
      allowedApps: current.behavior?.allowedApps || [],
    },
    profiles: {
      ...(current.profiles || {}),
      ko: { ...(current.profiles?.ko || {}), lang: "ko", register: byId("registerKo").value },
      ja: { ...(current.profiles?.ja || {}), lang: "ja", register: byId("registerJa").value },
      fr: { ...(current.profiles?.fr || {}), lang: "fr", register: byId("registerFr").value },
    },
  };
}

async function saveConfig(button, message) {
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const key = byId("anthropicKey").value.trim();
    if (key) {
      state.secret = await appApi.saveSecret(key);
      byId("anthropicKey").value = "";
    }
    renderConfig(await request("/api/config", "PUT", configFromForm(), 8000));
    if (key) appApi.restartService();
    renderKeyState();
    showToast(message);
  } catch (error) {
    showToast(error.message || "Couldn’t save those settings", true);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

async function sendControl(action, value = "") {
  try {
    await request("/api/control", "POST", { action, value }, 3000);
    return true;
  } catch (error) {
    const recoverable = /unknown control action|fetch failed|econnrefused|socket|service.?request/i.test(String(error?.message || ""));
    if (recoverable) {
      try {
        await appApi.restartService();
        await new Promise((resolve) => setTimeout(resolve, 1400));
        await request("/api/control", "POST", { action, value }, 3000);
        return true;
      } catch {}
    }
    showToast("Relay couldn’t reach the typing helper. Reopen Relay and try again.", true);
    return false;
  }
}

function retryAutoCommand(command) {
  const pending = state.pendingAuto;
  if (!pending?.enabled) return;
  setTimeout(async () => {
    if (state.pendingAuto !== pending || state.status?.runtime?.autoLang === pending.language) return;
    pending.until = Date.now() + 5000;
    await syncSafetyApps();
    await sendControl(command.action, command.value);
  }, 1500);
}

function retrySelectionPopup(enabled) {
  const pending = state.pendingSelectionPopup;
  setTimeout(async () => {
    if (state.pendingSelectionPopup !== pending || state.status?.runtime?.selectionPopupEnabled === enabled) return;
    pending.until = Date.now() + 5000;
    await sendControl("selection-popup", String(enabled));
  }, 1500);
}

async function translateQuick() {
  if (state.quickRequestId) {
    const current = state.quickRequestId;
    state.quickRequestId = "";
    await appApi.cancelRequest(current);
    byId("quickError").textContent = "Cancelled.";
    return;
  }

  const text = byId("quickInput").value.trim();
  const errorLabel = byId("quickError");
  if (!text) {
    errorLabel.textContent = "Type or paste something first.";
    byId("quickInput").focus();
    return;
  }

  const button = byId("translateButton");
  const output = byId("quickOutput");
  const surface = byId("translationSurface");
  const requestId = crypto.randomUUID();
  state.quickRequestId = requestId;
  errorLabel.textContent = "";
  button.classList.add("loading");
  button.querySelector("span").textContent = "Cancel";
  surface.classList.add("is-loading");
  surface.setAttribute("aria-busy", "true");
  output.classList.add("placeholder");
  output.textContent = "Translating…";
  setHidden(byId("copyOutputButton"), true);
  try {
    const translated = await request("/translate", "POST", {
      text,
      target: byId("quickTarget").value,
      origin: "quick",
      app: "Relay",
    }, 60000, requestId);
    if (state.quickRequestId !== requestId) return;
    output.textContent = translated;
    output.classList.remove("placeholder");
    setHidden(byId("copyOutputButton"), false);
    loadHistory();
  } catch (error) {
    if (state.quickRequestId !== requestId) return;
    output.textContent = "Translation appears here…";
    output.classList.add("placeholder");
    errorLabel.textContent = /abort/i.test(error.message || "") ? "Cancelled." : error.message || "Translation failed. Try again.";
  } finally {
    if (state.quickRequestId === requestId) state.quickRequestId = "";
    if (!state.quickRequestId) {
      button.classList.remove("loading");
      button.querySelector("span").textContent = "Translate";
      surface.classList.remove("is-loading");
      surface.setAttribute("aria-busy", "false");
    }
  }
}

function applyPreferences(info) {
  state.preferences = info;
  document.documentElement.dataset.theme = info.dark ? "dark" : "light";
  byId("themeSelect").value = info.theme || "system";
  byId("shortcutSelect").value = info.openShortcut || "Control+Alt+T";
  setSwitch(byId("startupSwitch"), Boolean(info.openAtLogin));
  byId("startupSwitch").disabled = !info.startupSupported;
  byId("startupSwitch").title = info.startupSupported ? "" : "Available in the installed app";
  syncSelectControls();
}

async function loadPreferences() {
  try {
    applyPreferences(await appApi.getPreferences());
  } catch {}
}

function setSetupProvider(provider) {
  state.setupProvider = provider;
  document.querySelectorAll(".setup-provider").forEach((button) => {
    button.classList.toggle("active", button.dataset.setupProvider === provider);
  });
  setHidden(byId("setupOllamaPanel"), provider !== "ollama");
  setHidden(byId("setupAnthropicPanel"), provider !== "anthropic");
  renderSetupStatus();
}

function renderSetupStatus() {
  const backend = state.status?.backend || { state: "checking", message: "Checking Ollama…" };
  const dot = byId("setupStatusDot");
  const title = byId("setupStatusTitle");
  const detail = byId("setupStatusDetail");
  const finish = byId("setupFinishButton");
  const test = byId("setupTestPanel");

  if (state.setupProvider === "anthropic") {
    finish.disabled = !state.secret.hasKey;
    setHidden(test, !state.secret.hasKey);
    return;
  }

  const ready = state.status?.provider === "ollama" && backend.state === "ready";
  const missingModel = /model|pull|not found/i.test(backend.message || "");
  setStatusMark(dot, ready ? "ready" : backend.state === "error" ? "error" : "checking");
  title.textContent = ready ? "Ollama is ready" : missingModel ? "Relay needs the model" : backend.state === "error" ? "Ollama needs attention" : "Checking Ollama…";
  detail.textContent = ready ? "Translations can run privately on this PC." : backend.message || "This only takes a moment.";
  byId("setupPullButton").textContent = missingModel ? "Download model" : "Try download";
  setHidden(byId("setupPullButton"), ready);
  setHidden(byId("setupOllamaDownloadButton"), ready);
  finish.disabled = !ready;
  setHidden(test, !ready);
}

function showSetup(force = false) {
  if (!force && state.setupDismissed) return;
  setHidden(byId("setupOverlay"), false);
  setSetupProvider(state.provider === "anthropic" ? "anthropic" : "ollama");
}

async function pollModelPull() {
  let result;
  try {
    result = await request("/api/backend/pull", "GET", undefined, 5000);
  } catch (error) {
    result = { state: "error", message: error.message || "Couldn’t check the download" };
  }
  const progress = byId("setupProgress");
  setHidden(progress, result.state !== "downloading");
  byId("setupProgressBar").style.width = (result.percent || 0) + "%";
  byId("setupStatusTitle").textContent = result.state === "downloading" ? "Downloading model" : result.state === "ready" ? "Model downloaded" : "Download failed";
  byId("setupStatusDetail").textContent = result.message || "";
  setStatusMark(byId("setupStatusDot"), result.state === "ready" ? "ready" : result.state === "error" ? "error" : "checking");
  if (result.state === "downloading") {
    setTimeout(pollModelPull, 500);
  } else {
    byId("setupPullButton").disabled = false;
    await refreshStatusOnce();
  }
}

async function refreshStatusOnce() {
  try {
    renderStatus(await request("/api/status", "GET", undefined, 4000));
  } catch {}
}

async function saveSetupProvider() {
  if (!state.config) return;
  state.provider = state.setupProvider;
  state.config.provider = state.setupProvider;
  state.config = await request("/api/config", "PUT", configFromForm(), 8000);
  renderConfig(state.config);
}

async function lockTarget(processName) {
  if (!processName) return false;
  if (blockedApp(processName)) {
    closeTargetMenu();
    showToast("Relay never types automatically in terminals or password managers", true);
    return false;
  }
  if (!await ensureAllowedApp(processName)) return false;
  state.lockedTarget = processName;
  localStorage.setItem("relay.targetApp", processName);
  rememberTarget(processName);
  const profile = savedAppProfiles()[processName.toLowerCase()] || {};
  if (["ko", "ja", "fr"].includes(profile.language)) state.autoLanguage = profile.language;
  byId("autoLanguageSelect").value = state.autoLanguage;
  if (["instant", "review"].includes(profile.sendMode)) byId("sendModeSelect").value = profile.sendMode;
  const configRegister = state.config?.profiles?.[state.autoLanguage]?.register;
  byId("autoToneSelect").value = profile.tone || toneForRegister(state.autoLanguage, configRegister);
  applyTone(byId("autoToneSelect").value);
  rememberProfile(processName, {
    language: state.autoLanguage,
    sendMode: byId("sendModeSelect").value,
    tone: byId("autoToneSelect").value,
  });
  syncSelectControls();
  closeTargetMenu();
  if (state.status) renderStatus(state.status);
  await sendControl("send-mode", byId("sendModeSelect").value);
  await saveBehaviorPatch({ sendMode: byId("sendModeSelect").value, lastLanguage: state.autoLanguage });
  if (byId("autoSwitch").getAttribute("aria-checked") === "true") {
    const command = autoCommand();
    await sendControl(command.action, command.value);
  }
  showToast("Relay will use " + friendlyProcess(processName));
  return true;
}

function bindEvents() {
  document.querySelectorAll(".settings-nav-item, .settings-back").forEach((item) => {
    item.addEventListener("click", () => setPage(item.dataset.page));
  });
  byId("settingsButton").addEventListener("click", () => setPage(state.page === "home" ? "voice" : "home"));
  byId("targetMenuButton").addEventListener("click", () => {
    closeSelect();
    state.targetMenuOpen = !state.targetMenuOpen;
    setHidden(byId("targetMenu"), !state.targetMenuOpen);
    byId("targetMenuButton").classList.toggle("open", state.targetMenuOpen);
    byId("targetMenuButton").setAttribute("aria-expanded", String(state.targetMenuOpen));
    if (state.targetMenuOpen) renderTargetMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!state.targetMenuOpen) return;
    if (!byId("targetMenu").contains(event.target) && !byId("targetMenuButton").contains(event.target)) closeTargetMenu();
  });

  byId("autoLanguageSelect").addEventListener("change", async () => {
    state.autoLanguage = byId("autoLanguageSelect").value;
    const profile = savedAppProfiles()[state.lockedTarget.toLowerCase()] || {};
    const configRegister = state.config?.profiles?.[state.autoLanguage]?.register;
    byId("autoToneSelect").value = profile.tone || toneForRegister(state.autoLanguage, configRegister);
    applyTone(byId("autoToneSelect").value);
    rememberProfile(state.lockedTarget, { language: state.autoLanguage, tone: byId("autoToneSelect").value });
    syncSelectControls();
    if (byId("autoSwitch").getAttribute("aria-checked") === "true") {
      state.pendingAuto = { enabled: true, language: state.autoLanguage, until: Date.now() + 5000 };
      const command = autoCommand();
      if (!await sendControl(command.action, command.value)) state.pendingAuto = null;
      else retryAutoCommand(command);
    }
    saveBehaviorPatch({ lastLanguage: state.autoLanguage });
  });
  byId("autoSwitch").addEventListener("click", async () => {
    const enabled = byId("autoSwitch").getAttribute("aria-checked") === "true";
    const next = !enabled;
    if (next) {
      const target = state.lockedTarget || state.status?.runtime?.targetProc || "";
      if (!target) {
        showToast("Open the app you want Relay to use first", true);
        return;
      }
      if (!state.lockedTarget) {
        if (!await lockTarget(target)) return;
      } else if (!await ensureAllowedApp(target)) {
        showToast("Choose an allowed app first", true);
        return;
      }
    }
    state.pendingAuto = { enabled: next, language: state.autoLanguage, until: Date.now() + 5000 };
    setSwitch(byId("autoSwitch"), next);
    byId("sessionControl").classList.toggle("on", next);
    const command = next ? autoCommand() : { action: "auto-off", value: "" };
    if (!await sendControl(command.action, command.value)) {
      state.pendingAuto = null;
      setSwitch(byId("autoSwitch"), enabled);
      byId("sessionControl").classList.toggle("on", enabled);
    } else if (next) retryAutoCommand(command);
  });
  byId("useCurrentAppButton").addEventListener("click", async () => {
    const target = state.status?.runtime?.targetProc || "";
    await lockTarget(target);
  });
  byId("sendModeSelect").addEventListener("change", async () => {
    const mode = byId("sendModeSelect").value;
    rememberProfile(state.lockedTarget, { sendMode: mode });
    await sendControl("send-mode", mode);
    saveBehaviorPatch({ sendMode: mode });
  });
  byId("autoToneSelect").addEventListener("change", async () => {
    const tone = byId("autoToneSelect").value;
    applyTone(tone);
    rememberProfile(state.lockedTarget, { tone });
    saveBehaviorPatch({});
  });
  byId("historyButton").addEventListener("click", () => state.historyOpen ? closeHistory() : openHistory());
  byId("selectionPopupSwitch").addEventListener("click", async () => {
    const button = byId("selectionPopupSwitch");
    const current = button.getAttribute("aria-checked") === "true";
    const next = !current;
    state.pendingSelectionPopup = { enabled: next, until: Date.now() + 5000 };
    button.disabled = true;
    setSwitch(button, next);
    const saved = await saveBehaviorPatch({ selectionPopupEnabled: next });
    const synced = saved && await sendControl("selection-popup", String(next));
    if (!synced) {
      state.pendingSelectionPopup = null;
      setSwitch(button, current);
      if (saved) await saveBehaviorPatch({ selectionPopupEnabled: current });
      button.disabled = false;
      return;
    }
    retrySelectionPopup(next);
  });
  byId("closeHistoryButton").addEventListener("click", closeHistory);
  byId("historyScrim").addEventListener("click", closeHistory);
  byId("historySwitch").addEventListener("click", async () => {
    const current = byId("historySwitch").getAttribute("aria-checked") === "true";
    const next = !current;
    setSwitch(byId("historySwitch"), next);
    if (!await saveBehaviorPatch({ historyEnabled: next })) setSwitch(byId("historySwitch"), current);
    loadHistory();
  });
  byId("clearHistoryButton").addEventListener("click", async () => {
    const button = byId("clearHistoryButton");
    if (!state.clearHistoryArmed) {
      state.clearHistoryArmed = true;
      button.textContent = "Click again to clear";
      setTimeout(() => {
        state.clearHistoryArmed = false;
        button.textContent = "Clear history";
      }, 3000);
      return;
    }
    state.clearHistoryArmed = false;
    button.textContent = "Clear history";
    try {
      await request("/api/history", "DELETE", undefined, 4000);
      await loadHistory();
      showToast("History cleared");
    } catch (error) {
      showToast(error.message || "Couldn’t clear history", true);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.historyOpen) closeHistory();
  });

  byId("quickInput").addEventListener("input", () => {
    const length = byId("quickInput").value.length;
    byId("characterCount").textContent = length ? length + " / 2000" : "";
    byId("quickError").textContent = "";
  });
  byId("quickInput").addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      translateQuick();
    }
  });
  byId("translateButton").addEventListener("click", translateQuick);
  byId("swapLanguagesButton").addEventListener("click", () => {
    const source = byId("quickSource");
    const target = byId("quickTarget");
    const oldSource = source.value;
    const oldTarget = target.value;
    source.value = oldTarget;
    target.value = oldSource === "auto" ? (oldTarget === "en" ? "ja" : "en") : oldSource;
    const output = byId("quickOutput");
    if (!output.classList.contains("placeholder")) {
      const input = byId("quickInput");
      const oldInput = input.value;
      input.value = output.textContent;
      output.textContent = oldInput;
      byId("characterCount").textContent = input.value.length + " / 2000";
    }
    syncSelectControls();
  });
  byId("copyOutputButton").addEventListener("click", async () => {
    const button = byId("copyOutputButton");
    await appApi.copy(byId("quickOutput").textContent);
    button.classList.add("copied");
    button.querySelector("span").textContent = "Copied";
    showToast("Copied to clipboard");
    setTimeout(() => {
      button.classList.remove("copied");
      button.querySelector("span").textContent = "Copy";
    }, 1400);
  });

  document.querySelectorAll(".provider-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.provider = card.dataset.provider;
      renderProvider();
    });
  });

  byId("saveVoiceButton").addEventListener("click", () => saveConfig(byId("saveVoiceButton"), "Voice and tone saved"));
  byId("saveSettingsButton").addEventListener("click", () => saveConfig(byId("saveSettingsButton"), "Engine settings saved"));
  byId("themeSelect").addEventListener("change", async () => {
    try {
      applyPreferences(await appApi.setTheme(byId("themeSelect").value));
    } catch (error) {
      showToast(error.message || "Couldn’t change the appearance", true);
    }
  });
  byId("startupSwitch").addEventListener("click", async () => {
    const next = byId("startupSwitch").getAttribute("aria-checked") !== "true";
    setSwitch(byId("startupSwitch"), next);
    try {
      applyPreferences(await appApi.setStartup(next));
    } catch (error) {
      setSwitch(byId("startupSwitch"), !next);
      showToast(error.message || "Couldn’t update startup", true);
    }
  });
  byId("shortcutSelect").addEventListener("change", async () => {
    const result = await appApi.setOpenShortcut(byId("shortcutSelect").value);
    byId("shortcutState").textContent = result.ok ? "Saved" : result.message;
    byId("shortcutState").classList.toggle("error", !result.ok);
    if (!result.ok) {
      byId("shortcutSelect").value = result.shortcut;
      syncSelectControls();
    }
  });
  byId("recheckButton").addEventListener("click", async () => {
    const button = byId("recheckButton");
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      const backend = await request("/api/backend/recheck", "POST", {}, 15000);
      showToast(backend.message, backend.state === "error");
    } catch (error) {
      showToast(error.message || "Couldn’t check the connection", true);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  });

  byId("downloadOllamaButton").addEventListener("click", () => appApi.openExternal("https://ollama.com/download"));
  byId("checkUpdateButton").addEventListener("click", () => {
    byId("updateState").textContent = "Checking for updates…";
    appApi.checkUpdates?.();
  });
  byId("installUpdateButton").addEventListener("click", () => appApi.installUpdate?.());
  appApi.onUpdate?.((info) => {
    const label = byId("updateState");
    const install = byId("installUpdateButton");
    setHidden(install, true);
    if (info.state === "available" && info.portable) {
      label.textContent = "Version " + info.version + " is out — open the download page";
      install.textContent = "Get the update";
      setHidden(install, false);
    } else if (info.state === "available") {
      label.textContent = "Downloading version " + info.version + "…";
    } else if (info.state === "downloading") {
      label.textContent = "Downloading update — " + info.percent + "%";
    } else if (info.state === "ready") {
      label.textContent = "Version " + info.version + " is ready";
      install.textContent = "Restart to update";
      setHidden(install, false);
    } else if (info.state === "current") {
      label.textContent = "Relay is up to date";
    } else if (info.state === "error") {
      label.textContent = "Could not check for updates";
    }
  });
  byId("getKeyButton").addEventListener("click", () => appApi.openExternal("https://console.anthropic.com/settings/keys"));
  byId("removeKeyButton").addEventListener("click", async () => {
    try {
      byId("anthropicKey").value = "";
      state.secret = await appApi.removeSecret();
      appApi.restartService();
      renderKeyState();
      showToast("API key removed");
    } catch {}
  });
  document.querySelectorAll(".setup-provider").forEach((button) => {
    button.addEventListener("click", () => setSetupProvider(button.dataset.setupProvider));
  });
  byId("setupOllamaDownloadButton").addEventListener("click", () => appApi.openExternal("https://ollama.com/download"));
  byId("setupGetKeyButton").addEventListener("click", () => appApi.openExternal("https://console.anthropic.com/settings/keys"));
  byId("setupPullButton").addEventListener("click", async () => {
    const button = byId("setupPullButton");
    button.disabled = true;
    try {
      await saveSetupProvider();
      await request("/api/backend/pull", "POST", {}, 5000);
      pollModelPull();
    } catch (error) {
      button.disabled = false;
      byId("setupStatusDetail").textContent = error.message || "Couldn’t start the download";
    }
  });
  byId("setupSaveKeyButton").addEventListener("click", async () => {
    const button = byId("setupSaveKeyButton");
    button.disabled = true;
    try {
      state.secret = await appApi.saveSecret(byId("setupAnthropicKey").value);
      byId("setupAnthropicKey").value = "";
      await saveSetupProvider();
      appApi.restartService();
      renderKeyState();
      renderSetupStatus();
      showToast("API key protected by Windows");
    } catch (error) {
      showToast(error.message || "Couldn’t save that key", true);
    } finally {
      button.disabled = false;
    }
  });
  byId("setupTestButton").addEventListener("click", async () => {
    const button = byId("setupTestButton");
    const result = byId("setupTestResult");
    button.disabled = true;
    result.textContent = "Translating…";
    result.classList.add("placeholder");
    try {
      result.textContent = await request("/translate", "POST", { text: byId("setupTestInput").value, target: "ja", origin: "setup", app: "Relay" }, 60000);
      result.classList.remove("placeholder");
    } catch (error) {
      result.textContent = error.message || "That test didn’t work yet.";
    } finally {
      button.disabled = false;
    }
  });
  byId("setupLaterButton").addEventListener("click", () => {
    state.setupDismissed = true;
    setHidden(byId("setupOverlay"), true);
  });
  byId("setupFinishButton").addEventListener("click", async () => {
    try {
      await saveSetupProvider();
      await saveBehaviorPatch({ onboardingComplete: true });
      setHidden(byId("setupOverlay"), true);
      showToast("Relay is ready");
      byId("quickInput").focus();
    } catch (error) {
      showToast(error.message || "Couldn’t finish setup", true);
    }
  });
  byId("runSetupButton").addEventListener("click", () => showSetup(true));
  byId("openDataButton").addEventListener("click", () => appApi.openData());
  byId("minimizeButton").addEventListener("click", () => appApi.minimize());
  byId("maximizeButton").addEventListener("click", () => appApi.maximize());
  byId("closeButton").addEventListener("click", () => appApi.hide());
  appApi.onNavigate((page) => setPage(page === "settings" ? "settings" : page === "voice" ? "voice" : "home"));
}

async function start() {
  rememberTarget(state.lockedTarget);
  enhanceSelects();
  bindEvents();
  setPage("home");
  appApi.onTheme?.((info) => applyPreferences(info));
  try {
    const meta = await appApi.getMeta();
    byId("versionLabel").textContent = "Relay " + meta.version;
  } catch {
    byId("versionLabel").textContent = "Relay";
  }
  await refreshSecretStatus();
  await loadPreferences();
  await loadConfig();
  refreshStatus();
  setInterval(() => {
    if (state.historyOpen) loadHistory();
  }, 2500);
}

start();
