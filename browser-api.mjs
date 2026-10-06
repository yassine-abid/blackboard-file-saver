import { collectFrameCandidates } from "./scanner.mjs";
import { isBlackboardURL, mergeCandidates, safeFilename } from "./core.mjs";

export async function scanTab(api, tabId) {
  const frames = await api.webNavigation.getAllFrames({ tabId });
  const relevant = (frames || []).filter(frame => isBlackboardURL(frame.url));
  // Inject separately so an unrelated, inaccessible analytics frame cannot
  // prevent the actual document frame from being inspected.
  const results = await Promise.allSettled(relevant.map(frame => api.scripting.executeScript({
    target: { tabId, frameIds: [frame.frameId] },
    func: collectFrameCandidates,
    world: "ISOLATED"
  })));
  const candidates = relevant.map(frame => ({ url: frame.url, label: "", kind: "document" }));
  let inaccessibleFrames = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const frame of result.value) candidates.push(...(frame.result || []));
    } else inaccessibleFrames += 1;
  }
  return { files: mergeCandidates(candidates), inaccessibleFrames };
}

export async function startDownload(api, file) {
  if (!isBlackboardURL(file?.url)) throw new Error("Unsupported file address.");
  return api.downloads.download({
    url: file.url,
    filename: safeFilename(file.filename),
    conflictAction: "uniquify",
    saveAs: true
  });
}
