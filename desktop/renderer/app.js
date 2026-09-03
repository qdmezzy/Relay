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
  pendingHighlight: null,
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

async function request(path, method = "GET", body, timeout) {
  return appApi.request({ path, method, body, timeout });
}

function setPage(page) {
  if (!pageNames[page]) return;
  closeSelect();
  state.page = page;
  document.querySelectorAll(".settings-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });
  document.querySelectorAll(".page").forEach((item) => {
    item.classList.toggle("active", item.id === "page-" + page);
  });
  byId("settingsButton").classList.toggle("active", page !== "home");
  document.title = page === "home" ? "Relay" : pageNames[page] + " — Relay";
  document.querySelector(".main").scrollTo({ top: 0, behavior: "smooth" });
}

function setStatusMark(element, status) {
  element.classList.remove("ready", "error", "checking");
  element.classList.add(status);
}

function friendlyProcess(name) {
  if (!name) return "";
  return name.replace(/\.exe$/i, "").replace(/[-_]+/g, " ");
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
  const runtimeAuto = Boolean(runtime.autoLang);
  const runtimeHighlight = Boolean(runtime.highlight);
  const newMessage = runtime.message && runtime.message !== state.lastRuntimeMessage;

  if (state.pendingAuto) {
    const confirmed = runtimeAuto === state.pendingAuto.enabled
      && (!state.pendingAuto.enabled || runtime.autoLang === state.pendingAuto.language);
    if (confirmed || newMessage || Date.now() > state.pendingAuto.until) state.pendingAuto = null;
  }
  if (state.pendingHighlight) {
    if (runtimeHighlight === state.pendingHighlight.enabled || Date.now() > state.pendingHighlight.until) {
      state.pendingHighlight = null;
    }
  }

  if (runtime.autoLang && !state.pendingAuto) {
    state.autoLanguage = runtime.autoLang;
    byId("autoLanguageSelect").value = runtime.autoLang;
  }
  syncSelectControls();
  const autoEnabled = state.pendingAuto?.enabled ?? runtimeAuto;
  const highlightEnabled = state.pendingHighlight?.enabled ?? runtimeHighlight;
  setSwitch(byId("autoSwitch"), autoEnabled);
  setSwitch(byId("highlightSwitch"), highlightEnabled);
  byId("targetAppText").textContent = state.pendingAuto
    ? state.pendingAuto.enabled ? "Turning on for " + (target || "the last active app") + "…" : "Turning auto translate off…"
    : target ? runtimeAuto ? "Auto translate is active in " + target + "." : "Last active app: " + target + "."
      : "Open a chat once to set the target app.";

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
  byId("ollamaModel").value = config.providers?.ollama?.model || "qwen3:8b";
  byId("ollamaHost").value = config.providers?.ollama?.host || "http://127.0.0.1:11434";
  byId("anthropicModel").value = config.providers?.anthropic?.model || "claude-opus-5";
  byId("anthropicEffort").value = config.providers?.anthropic?.effort || "low";
  renderKeyState(config);
  renderProvider();
  syncSelectControls();
}

function renderKeyState(config) {
  const anthropic = config?.providers?.anthropic || {};
  const label = byId("keyState");
  const remove = byId("removeKeyButton");
  if (!label) return;

  if (anthropic.keyFromEnvironment) {
    label.textContent = "Using ANTHROPIC_API_KEY from Windows";
    setHidden(remove, true);
  } else if (anthropic.hasApiKey) {
    label.textContent = "Key saved";
    setHidden(remove, false);
  } else {
    label.textContent = "No key yet";
    setHidden(remove, true);
  }
}

async function loadConfig() {
  try {
    renderConfig(await request("/api/config", "GET", undefined, 5000));
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
        ...(byId("anthropicKey").value.trim()
          ? { apiKey: byId("anthropicKey").value.trim() }
          : {}),
      },
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
    renderConfig(await request("/api/config", "PUT", configFromForm(), 8000));
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
    showToast(error.message || "Couldn’t update the helper", true);
    return false;
  }
}

async function translateQuick() {
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
  errorLabel.textContent = "";
  button.disabled = true;
  button.classList.add("loading");
  button.querySelector("span").textContent = "Translating";
  surface.classList.add("is-loading");
  surface.setAttribute("aria-busy", "true");
  output.classList.add("placeholder");
  output.textContent = "Translating…";
  setHidden(byId("copyOutputButton"), true);
  try {
    const translated = await request("/translate", "POST", {
      text,
      target: byId("quickTarget").value,
    }, 60000);
    output.textContent = translated;
    output.classList.remove("placeholder");
    setHidden(byId("copyOutputButton"), false);
  } catch (error) {
    output.textContent = "Translation appears here…";
    output.classList.add("placeholder");
    errorLabel.textContent = error.message || "Translation failed";
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
    button.querySelector("span").textContent = "Translate";
    surface.classList.remove("is-loading");
    surface.setAttribute("aria-busy", "false");
  }
}

function bindEvents() {
  document.querySelectorAll(".settings-nav-item, .settings-back").forEach((item) => {
    item.addEventListener("click", () => setPage(item.dataset.page));
  });
  byId("settingsButton").addEventListener("click", () => setPage(state.page === "home" ? "voice" : "home"));

  byId("autoLanguageSelect").addEventListener("change", async () => {
    state.autoLanguage = byId("autoLanguageSelect").value;
    if (byId("autoSwitch").getAttribute("aria-checked") === "true") {
      state.pendingAuto = { enabled: true, language: state.autoLanguage, until: Date.now() + 5000 };
      if (!await sendControl("auto", state.autoLanguage)) state.pendingAuto = null;
    }
  });
  byId("autoSwitch").addEventListener("click", async () => {
    const enabled = byId("autoSwitch").getAttribute("aria-checked") === "true";
    const next = !enabled;
    state.pendingAuto = { enabled: next, language: state.autoLanguage, until: Date.now() + 5000 };
    setSwitch(byId("autoSwitch"), next);
    if (!await sendControl(next ? "auto" : "auto-off", next ? state.autoLanguage : "")) {
      state.pendingAuto = null;
      setSwitch(byId("autoSwitch"), enabled);
    }
  });
  byId("highlightSwitch").addEventListener("click", async () => {
    const enabled = byId("highlightSwitch").getAttribute("aria-checked") === "true";
    const next = !enabled;
    state.pendingHighlight = { enabled: next, until: Date.now() + 5000 };
    setSwitch(byId("highlightSwitch"), next);
    if (!await sendControl("highlight", next ? "on" : "off")) {
      state.pendingHighlight = null;
      setSwitch(byId("highlightSwitch"), enabled);
    }
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
    const next = configFromForm();
    next.providers = next.providers || {};
    next.providers.anthropic = { ...(next.providers.anthropic || {}), apiKey: null };
    try {
      byId("anthropicKey").value = "";
      renderConfig(await request("/api/config", "PUT", next, 8000));
    } catch {}
  });
  byId("openDataButton").addEventListener("click", () => appApi.openData());
  byId("minimizeButton").addEventListener("click", () => appApi.minimize());
  byId("maximizeButton").addEventListener("click", () => appApi.maximize());
  byId("closeButton").addEventListener("click", () => appApi.hide());
  appApi.onNavigate((page) => setPage(page === "settings" ? "settings" : page === "voice" ? "voice" : "home"));
}

async function start() {
  enhanceSelects();
  bindEvents();
  setPage("home");
  try {
    const meta = await appApi.getMeta();
    byId("versionLabel").textContent = "Relay " + meta.version;
  } catch {
    byId("versionLabel").textContent = "Relay";
  }
  loadConfig();
  refreshStatus();
}

start();
