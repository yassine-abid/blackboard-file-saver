import { collectFrameCandidates } from "./scanner.mjs";
import { isSupportedPageURL, isAWSAcademyURL, isAllowedDownloadURL, filesFromCandidate, mergeCandidates, safeFilename } from "./core.mjs";

export const AWS_GUIDE_ORIGINS = [
  "https://awsacademy.instructure.com/*",
  "https://emergingtalent.contentcontroller.com/*",
  "https://awsacademy.contentcontroller.com/*"
];

export async function missingAWSAccess(api) {
  if (!api.permissions?.contains) return [];
  const checks = await Promise.all(AWS_GUIDE_ORIGINS.map(async origin => ({origin, granted:await api.permissions.contains({origins:[origin]})})));
  return checks.filter(check => !check.granted).map(check => check.origin);
}

export async function scanTab(api, tabId) {
  const frames = await api.webNavigation.getAllFrames({ tabId });
  const relevant = (frames || []).filter(frame => isSupportedPageURL(frame.url));
  // Inject separately so an unrelated, inaccessible analytics frame cannot
  // prevent the actual document frame from being inspected.
  const results = await Promise.allSettled(relevant.map(frame => api.scripting.executeScript({
    target: { tabId, frameIds: [frame.frameId] },
    func: collectFrameCandidates,
    world: "ISOLATED"
  })));
  const candidates = relevant.map(frame => ({ url: frame.url, label: "", kind: "document" }));
  const sources = new Map();
  let inaccessibleFrames = 0;
  const blockedFrames = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      for (const frame of result.value) {
        if (frame.error) {
          inaccessibleFrames += 1;
          blockedFrames.push({host:new URL(relevant[index].url).hostname,reason:"The frame's scan failed."});
        } else {
          for (const candidate of frame.result || []) {
            candidates.push(candidate);
            for (const file of filesFromCandidate(candidate)) {
              if (file.provider !== "aws") continue;
              const previous = sources.get(file.url);
              const priority = candidate.kind === "captured" ? 2 : candidate.kind === "resource" ? 1 : 0;
              if (!previous || priority > previous.priority) sources.set(file.url,{sourceFrameId:relevant[index].frameId,sourceOrigin:new URL(relevant[index].url).origin,priority});
            }
          }
        }
      }
    } else {
      inaccessibleFrames += 1;
      const message = String(result.reason?.message || result.reason || "");
      // Never show a raw exception: it can contain launch/session URLs.
      const reason = /permission|denied|not allowed|access/i.test(message) ? "Browser access was denied." : "The frame could not be read.";
      blockedFrames.push({host:new URL(relevant[index].url).hostname,reason});
    }
  }
  const files = mergeCandidates(candidates).map(file => {
    const source = sources.get(file.url);
    return source ? {...file,sourceFrameId:source.sourceFrameId,sourceOrigin:source.sourceOrigin} : file;
  });
  return { files, inaccessibleFrames, blockedFrames };
}

export async function startDownload(api, file, tabId) {
  if (!isAllowedDownloadURL(file?.url)) throw new Error("Unsupported file address.");
  if (file.provider === "aws") {
    if (!Number.isInteger(tabId) || !Number.isInteger(file.sourceFrameId) || !isAWSAcademyURL(file.sourceOrigin)) throw new Error("Reopen the guide and refresh its file list.");
    const result=await api.runtime.sendMessage({type:"CFS_DOWNLOAD_PDF",tabId,file});
    if(!result?.ok)throw new Error(result?.error||"The PDF download could not start.");
    return {kind:"background-download",downloadId:result.downloadId};
  }
  return api.downloads.download({
    url: file.url,
    filename: safeFilename(file.filename),
    conflictAction: "uniquify",
    saveAs: true
  });
}
