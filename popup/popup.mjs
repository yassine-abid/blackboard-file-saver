import { isSupportedPageURL, isAWSAcademyURL } from "../scripts/core.mjs";
import { scanTab, startDownload, missingAWSAccess, AWS_GUIDE_ORIGINS } from "../scripts/browser-api.mjs";

const api = globalThis.browser || globalThis.chrome;
const count = document.querySelector("#count");
const status = document.querySelector("#status");
const filesList = document.querySelector("#files");
const refresh = document.querySelector("#refresh");
const empty = document.querySelector("#empty");
const allowAccess = document.querySelector("#allow-access");
const accessDetail = document.querySelector("#access-detail");
const emptyHeading = document.querySelector("#empty-heading");
const emptyDescription = document.querySelector("#empty-description");
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
    if(file.provider==="aws"&&!file.captured) {
      button.textContent="Reload guide to capture its PDF";
      button.disabled=true;
      variant.textContent="Wait for the original PDF response to be captured.";
    }
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
        const result=await startDownload(api, stillLoaded, currentTabId);
        setStatus(result?.kind==="background-download"?"Saved to your browser's Downloads folder.":"Download started. Check your browser's downloads for completion.");
      } catch(error) {
        setStatus(error instanceof Error?error.message:"The download could not start, or the save dialog was canceled. Reopen the preview and refresh to try again.", true);
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
  allowAccess.hidden = true;
  accessDetail.hidden = true;
  emptyHeading.textContent = "No original file detected";
  emptyDescription.textContent = "Wait for the guide or attachment to load, then choose Refresh.";
  count.textContent = "Looking for files…";
  setStatus("Checking this tab and its loaded previews.");
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isSupportedPageURL(tab.url)) {
      count.textContent = "Open your course to begin";
      setStatus("Use this extension on Blackboard, AWS Academy, or their document previews.");
      return;
    }
    currentTabId = tab.id;
    const missing = isAWSAcademyURL(tab.url) ? await missingAWSAccess(api) : [];
    const result = await scanTab(api, tab.id);
    renderFiles(result.files);
    if (missing.length || result.inaccessibleFrames) {
      allowAccess.hidden = !isAWSAcademyURL(tab.url);
      const hosts = [...new Set([...missing.map(origin => new URL(origin).hostname), ...result.blockedFrames.map(frame => frame.host)])];
      accessDetail.textContent = hosts.length ? `Viewer sites: ${hosts.join(", ")}` : "A viewer frame could not be read.";
      accessDetail.hidden = false;
      emptyHeading.textContent = "The viewer could not be read";
      emptyDescription.textContent = "Your guide can be open while its embedded viewer is blocked. Enable AWS guide access, then refresh. If needed, reload the course page once.";
    }
    const waiting=result.files.some(file=>file.provider==="aws"&&!file.captured);
    setStatus(result.files.length ? waiting ? "Reload the Student Guide page once, wait for its pages to load, then Refresh. Download becomes available after its original PDF is captured." : "Choose a file to save its complete document." : missing.length ? "AWS viewer access is not enabled yet. Use the button below to enable it." : result.inaccessibleFrames ? "Some viewer frames could not be read. Check the sites listed below." : "No original PDF found in the loaded guide. Try Refresh after the pages have appeared.");
  } catch {
    count.textContent = "Could not scan this tab";
    setStatus("Allow the extension on the course and viewer sites, reload the page, and try again.", true);
  } finally {
    scanning = false;
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", scan);
allowAccess.addEventListener("click", async () => {
  // Request immediately inside the user gesture, before any awaited work.
  const request = api.permissions.request({origins:AWS_GUIDE_ORIGINS});
  allowAccess.disabled = true;
  try {
    const granted = await request;
    if (granted) await scan();
    else setStatus("Viewer access was not enabled. The embedded guide cannot be scanned without it.", true);
  } catch { setStatus("Access could not be enabled. Check this extension's site permissions in your browser.", true); }
  finally { allowAccess.disabled = false; }
});
scan();
