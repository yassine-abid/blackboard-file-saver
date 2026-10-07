// Self-contained: Chrome serializes this function before running it in a frame.
// Read DOM references and this frame's loaded-resource names. Do not fetch,
// click, modify the page, inspect response bodies, or read cookies.
export function collectFrameCandidates() {
  const contextURL = location.href;
  const candidates = [{ url: contextURL, label: document.title, kind: "document", contextURL }];
  const viewer = /(^|\.)basic-doc-viewer\./i.test(location.hostname);
  const selector = viewer ? "iframe[src], embed[src], object[data]" : "a[href], iframe[src], embed[src], object[data]";
  for (const element of document.querySelectorAll(selector)) {
    const attribute = element.tagName === "OBJECT" ? "data" : element.tagName === "A" ? "href" : "src";
    const value = element.getAttribute(attribute);
    if (!value) continue;
    try {
      const url = new URL(value, document.baseURI).href;
      const label = element.getAttribute("title") || element.getAttribute("download") || element.getAttribute("aria-label") || element.textContent?.trim() || "";
      candidates.push({ url, label: label.slice(0, 250), kind: element.tagName.toLowerCase(), contextURL });
    } catch { /* Not a URL, so not a downloadable reference. */ }
  }
  // AWS Academy's SCORM guide loads its PDF via a request rather than a link.
  // Resource Timing exposes the URLs of requests already made by this frame.
  const awsFrame = location.hostname === "awsacademy.instructure.com" || /(^|\.)contentcontroller\.com$/i.test(location.hostname);
  if(awsFrame&&globalThis.__courseFileSaverCaptured) {
    for(const [url,entry] of globalThis.__courseFileSaverCaptured) candidates.push({url,label:document.title,kind:"captured",contextURL,capturedSize:entry.bytes.byteLength});
  }
  if (awsFrame && typeof performance !== "undefined") {
    for (const entry of performance.getEntriesByType("resource")) {
      try {
        const url = new URL(entry.name);
        const pdf = /\.pdf$/i.test(url.pathname) || url.searchParams.get("response-content-type")?.toLowerCase() === "application/pdf";
        if (url.protocol === "https:" && pdf) candidates.push({ url: entry.name, label: document.title, kind: "resource", contextURL });
      } catch { /* Ignore non-file resource names. */ }
    }
  }
  return candidates;
}
