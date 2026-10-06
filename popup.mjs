import { isBlackboardURL } from "./core.mjs";
import { scanTab, startDownload } from "./browser-api.mjs";

const api = globalThis.browser || globalThis.chrome;
const count = document.querySelector("#count");
const status = document.querySelector("#status");
const filesList = document.querySelector("#files");
const refresh = document.querySelector("#refresh");
const empty = document.querySelector("#empty");
let currentTabId;
let scanning = false;

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function renderFiles(files) {
  filesList.replaceChildren();
  count.textContent = `${files.length} file${files.length === 1 ? "" : "s"} found`;
  empty.hidden = files.length > 0;
  for (const file of files) {
    const row = document.createElement("li");
    row.className = "file";
    const top = document.createElement("div");
    top.className = "file-top";
    const type = document.createElement("span");
    type.className = "type";
    type.textContent = file.type;
    const details = document.createElement("div");
    const name = document.createElement("p");
    name.className = "name";
    name.textContent = file.filename;
    const variant = document.createElement("p");
    variant.className = "variant";
    variant.textContent = file.variant;
    details.append(name, variant);
    top.append(type, details);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "download";
    button.textContent = "Download file";
    button.setAttribute("aria-label", `Download ${file.filename}`);
    button.addEventListener("click", async () => {
      button.disabled = true;
      setStatus("Preparing your download…");
      try {
        // Check the same tab again: the user may have navigated or the signed
        // file reference may have changed since the popup first opened.
        const fresh = await scanTab(api, currentTabId);
        const stillLoaded = fresh.files.find(item => item.url === file.url);
        if (!stillLoaded) {
          renderFiles(fresh.files);
          setStatus("The preview changed. Choose a file from the refreshed list.");
          return;
        }
        await startDownload(api, stillLoaded);
        setStatus("Download started. Check your browser’s downloads for completion.");
      } catch {
        setStatus("The download could not start, or the save dialog was canceled. Reopen the preview and refresh to try again.", true);
      } finally { button.disabled = false; }
    });
    row.append(top, button);
    filesList.append(row);
  }
}

async function scan() {
  if (scanning) return;
  scanning = true;
  refresh.disabled = true;
  filesList.replaceChildren();
  empty.hidden = true;
  count.textContent = "Looking for files…";
  setStatus("Checking this tab and its loaded previews.");
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isBlackboardURL(tab.url)) {
      count.textContent = "Open Blackboard to begin";
      setStatus("Use this extension on your Blackboard course page or document preview.");
      return;
    }
    currentTabId = tab.id;
    const result = await scanTab(api, tab.id);
    renderFiles(result.files);
    setStatus(result.files.length ? "Choose a file to save its complete document." : result.inaccessibleFrames ? "Some previews could not be read. Allow this extension on Blackboard, reload the course page, and open the attachment." : "No file found in the previews currently loaded.");
  } catch {
    count.textContent = "Could not scan this tab";
    setStatus("Allow the extension on Blackboard, reload the course page, and try again.", true);
  } finally {
    scanning = false;
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", scan);
scan();
