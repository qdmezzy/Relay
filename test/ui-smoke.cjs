const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {
  const errors = [];
  const window = new BrowserWindow({
    show: false,
    width: 1062,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "ui-preload.cjs"),
    },
  });

  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) errors.push(message);
  });

  await window.loadFile(path.join(__dirname, "..", "desktop", "renderer", "index.html"));
  await window.webContents.insertCSS("*, *::before, *::after { animation: none !important; transition: none !important; }");
  await new Promise((resolve) => setTimeout(resolve, 700));

  const result = await window.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.translation-surface').getBoundingClientRect();
    const controls = document.querySelector('.session-control').getBoundingClientRect();
    const main = document.querySelector('.main');
    const popupSwitch = document.getElementById('selectionPopupSwitch');
    const nativeSelect = document.getElementById('quickTarget');
    main.scrollTop = 0;
    return {
      title: document.querySelector('.app-brand strong').textContent.trim(),
      tagline: document.querySelector('.app-brand span').textContent.trim(),
      quickVisible: surface.width > 700 && surface.height > controls.height * 3,
      popupVisible: popupSwitch.getBoundingClientRect().width > 0,
      popupOn: popupSwitch.getAttribute('aria-checked') === 'true',
      customSelect: nativeSelect.classList.contains('select-native') && nativeSelect.nextElementSibling?.classList.contains('select-button'),
      scrollbarHidden: getComputedStyle(main).scrollbarWidth === 'none',
      setupHidden: document.getElementById('setupOverlay').classList.contains('hidden'),
      contentOpaque: getComputedStyle(document.querySelector('.page.active')).opacity === '1',
    };
  })()`);

  assert.equal(result.title, "Relay");
  assert.equal(result.tagline, "Translate as you type.");
  assert.equal(result.quickVisible, true);
  assert.equal(result.popupVisible, true);
  assert.equal(result.popupOn, true);
  assert.equal(result.customSelect, true);
  assert.equal(result.scrollbarHidden, true);
  assert.equal(result.setupHidden, true);
  assert.equal(result.contentOpaque, true);
  assert.deepEqual(errors, []);

  const screenshotPath = path.join(__dirname, "..", ".release", "ui-smoke.png");
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());

  console.log("Relay UI passed layout, branding, popup, dropdown, and scrollbar checks.");
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
