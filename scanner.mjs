// Self-contained: Chrome serializes this function before running it in a frame.
// Read only DOM references. Do not fetch, click, modify the page, or read cookies.
export function collectFrameCandidates() {
  const candidates = [{ url: location.href, label: document.title, kind: "document" }];
  const viewer = /(^|\.)basic-doc-viewer\./i.test(location.hostname);
  const selector = viewer ? "iframe[src], embed[src], object[data]" : "a[href], iframe[src], embed[src], object[data]";
  for (const element of document.querySelectorAll(selector)) {
    const attribute = element.tagName === "OBJECT" ? "data" : element.tagName === "A" ? "href" : "src";
    const value = element.getAttribute(attribute);
    if (!value) continue;
    try {
      const url = new URL(value, document.baseURI).href;
      const label = element.getAttribute("title") || element.getAttribute("download") || element.getAttribute("aria-label") || element.textContent?.trim() || "";
      candidates.push({ url, label: label.slice(0, 250), kind: element.tagName.toLowerCase() });
    } catch { /* Not a URL, so not a downloadable reference. */ }
  }
  return candidates;
}
