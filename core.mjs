const DOCUMENT_EXTENSIONS = /\.(pdf|pptx?|docx?|xlsx?|txt|csv|od[pts]|rtf)$/i;
const MIME_EXTENSIONS = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.ms-excel": "xls",
  "text/plain": "txt",
  "text/csv": "csv"
};

export function isBlackboardURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "blackboard.com" || url.hostname.endsWith(".blackboard.com"));
  } catch { return false; }
}

function decodeFilename(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function safeFilename(value, fallback = "Blackboard-document.pdf") {
  const cleaned = String(value || "").normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!cleaned) return fallback;
  const guarded = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
  if (guarded.length <= 180) return guarded;
  const extension = guarded.match(/\.[a-z0-9]{1,8}$/i)?.[0] || "";
  return guarded.slice(0, 180 - extension.length) + extension;
}

export function filenameFromURL(value) {
  const url = new URL(value);
  const disposition = url.searchParams.get("response-content-disposition") || "";
  const utf8 = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)'[^']*'([^;]+)/i);
  const basic = disposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  const name = utf8 ? decodeFilename(utf8[1].trim()) : basic ? (basic[1] || basic[2]).trim() : decodeFilename(url.pathname.split("/").pop() || "");
  return name;
}

function candidateFile(source, label, format, fromViewer) {
  if (!isBlackboardURL(source)) return null;
  const url = new URL(source);
  // An inline-only bbcswebdav URL returns viewer HTML, not the original file.
  if (url.pathname.includes("/bbcswebdav/") && (url.searchParams.get("render") === "inlineOnly" || url.searchParams.get("isInlineRender") === "true")) return null;
  const sourceName = filenameFromURL(source);
  const mimeExtension = MIME_EXTENSIONS[(url.searchParams.get("response-content-type") || "").toLowerCase()];
  const labelName = String(label || "").match(/([^\n]+\.(?:pdf|pptx?|docx?|xlsx?|txt|csv|od[pts]|rtf))\s*$/i)?.[1];
  let name = DOCUMENT_EXTENSIONS.test(sourceName) ? sourceName : labelName || "";
  if (name && (format === "pdf" || mimeExtension === "pdf") && !/\.pdf$/i.test(name)) name = name.replace(DOCUMENT_EXTENSIONS, ".pdf");
  if (!name && (format === "pdf" || mimeExtension)) name = `Blackboard-document.${format === "pdf" ? "pdf" : mimeExtension}`;
  if (!name || !DOCUMENT_EXTENSIONS.test(name)) return null;
  if (!fromViewer && !/\.files\.blackboard\.com$/i.test(url.hostname) && !url.pathname.includes("/bbcswebdav/") && !DOCUMENT_EXTENSIONS.test(url.pathname)) return null;
  const filename = safeFilename(name);
  return { url: source, filename, type: filename.split(".").pop().toUpperCase(), variant: format === "pdf" ? "PDF preview file" : "Original document" };
}

export function filesFromCandidate(candidate) {
  if (!isBlackboardURL(candidate?.url)) return [];
  const url = new URL(candidate.url);
  const viewerHost = /(^|\.)basic-doc-viewer\./i.test(url.hostname);
  const files = [];
  if (viewerHost) {
    // URLSearchParams performs exactly one outer decoding. Do not decode a
    // signed URL again: that would change escaped +, &, %, or / in its token.
    for (const [parameter, format] of [["originalUrl", "original"], ["pdfUrl", "pdf"]]) {
      const source = url.searchParams.get(parameter);
      if (source) {
        const file = candidateFile(source, candidate.label, format, true);
        if (file) files.push(file);
      }
    }
  } else {
    const file = candidateFile(candidate.url, candidate.label, "original", false);
    if (file) files.push(file);
  }
  return files;
}

export function mergeCandidates(candidates) {
  const files = new Map();
  for (const candidate of candidates) {
    for (const file of filesFromCandidate(candidate)) {
      if (!files.has(file.url)) files.set(file.url, file);
    }
  }
  return [...files.values()];
}
