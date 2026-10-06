import test from "node:test";
import assert from "node:assert/strict";
import { isBlackboardURL, filesFromCandidate, mergeCandidates, safeFilename } from "../core.mjs";
import { collectFrameCandidates } from "../scanner.mjs";

const source = (name = "Lab_Azure.pdf", mime = "application/pdf") => "https://prod01-euc1.prod.files.blackboard.com/opaque/38263168?" + new URLSearchParams({
  "response-content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(name),
  "response-content-type": mime,
  "X-Blackboard-Signature": "a+/b%=&opaque"
});
const viewer = (pdf, original = pdf) => "https://basic-doc-viewer.eu.api.blackboard.com/ui/163/example/index.html?" + new URLSearchParams({pdfUrl:pdf, originalUrl:original,render:"inlineOnly"});

test("extracts the original from an opaque signed viewer URL without corrupting its token", () => {
  const url=source();
  const files=mergeCandidates([{url:viewer(url),label:"Document Rendering"}]);
  assert.equal(files.length,1);
  assert.equal(files[0].url,url);
  assert.equal(files[0].filename,"Lab_Azure.pdf");
});
test("handles a PDF-only viewer and preserves Unicode filenames", () => {
  const url="https://basic-doc-viewer.us.api.blackboard.com/ui/test?"+new URLSearchParams({pdfUrl:source("Sécurité du cloud.pdf")});
  assert.equal(filesFromCandidate({url})[0].filename,"Sécurité du cloud.pdf");
});
test("shows original PowerPoint and its distinct converted PDF", () => {
  const files=mergeCandidates([{url:viewer(source("slides.pdf"),source("slides.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation"))}]);
  assert.deepEqual(files.map(f=>f.filename),["slides.pptx","slides.pdf"]);
});
test("converted PDF does not inherit a PowerPoint filename from its label", () => {
  const url="https://basic-doc-viewer.eu.api.blackboard.com/ui/test?"+new URLSearchParams({pdfUrl:"https://prod.files.blackboard.com/opaque/123"});
  assert.equal(filesFromCandidate({url,label:"slides.pptx"})[0].filename,"slides.pdf");
});
test("deduplicates the same file seen in more than one frame", () => {
  const url=source();
  assert.equal(mergeCandidates([{url:viewer(url)},{url:viewer(url)},{url}]).length,1);
});
test("rejects non-Blackboard, HTTP, spoofed, credential-bearing and malformed references", () => {
  for(const url of ["http://esprit.blackboard.com/file.pdf","https://blackboard.com.evil.example/file.pdf","https://user:pass@esprit.blackboard.com/file.pdf","javascript:alert(1)","file:///etc/passwd","broken"]) {
    assert.equal(isBlackboardURL(url),false);
    assert.deepEqual(filesFromCandidate({url}),[]);
  }
  assert.deepEqual(filesFromCandidate({url:viewer("https://example.com/file.pdf")}),[]);
  assert.deepEqual(filesFromCandidate({url:"https://esprit.blackboard.com/ultra/course?pdfUrl="+encodeURIComponent(source())}),[]);
});
test("never mistakes inline bbcswebdav viewer HTML for a PDF", () => {
  const url="https://esprit.blackboard.com/bbcswebdav/xid-123?isInlineRender=true&render=inlineOnly";
  assert.deepEqual(filesFromCandidate({url,label:"Lab_Azure.pdf"}),[]);
});
test("recognizes a direct attachment with a document label and an opaque bbcswebdav path", () => {
  const url="https://esprit.blackboard.com/bbcswebdav/xid-123?xythos-download=true";
  assert.equal(filesFromCandidate({url,label:"Lab_Azure.pdf"})[0].filename,"Lab_Azure.pdf");
});
test("supports direct document references and MIME fallback, but excludes executable files", () => {
  assert.equal(filesFromCandidate({url:"https://esprit.blackboard.com/files/notes.odt"})[0].type,"ODT");
  assert.deepEqual(filesFromCandidate({url:source("program.exe","application/octet-stream")}),[]);
  const pdf="https://basic-doc-viewer.eu.api.blackboard.com/ui/test?"+new URLSearchParams({pdfUrl:"https://prod.files.blackboard.com/opaque/123"});
  assert.equal(filesFromCandidate({url:pdf})[0].filename,"Blackboard-document.pdf");
});
test("sanitizes traversal, reserved names, controls and overly long filenames", () => {
  assert.equal(safeFilename("../../Cloud:security.pdf"),"____Cloud_security.pdf");
  assert.equal(safeFilename("CON.pdf"),"_CON.pdf");
  assert.equal(safeFilename("\u0000\u202etest.pdf"),"test.pdf");
  const long=safeFilename("a".repeat(300)+".pdf");
  assert.equal(long.length,180);
  assert.ok(long.endsWith(".pdf"));
});
test("DOM scanner resolves relative references without fetching or mutating the page", () => {
  const oldDocument=globalThis.document, oldLocation=globalThis.location;
  const element={tagName:"A",textContent:"Notes.pdf",getAttribute(name){return name==="href"?"/files/Notes.pdf":null;}};
  globalThis.location={href:"https://esprit.blackboard.com/ultra/course",hostname:"esprit.blackboard.com"};
  globalThis.document={title:"Course",baseURI:globalThis.location.href,querySelectorAll(){return [element];}};
  try {
    const candidates=collectFrameCandidates();
    assert.equal(candidates[1].url,"https://esprit.blackboard.com/files/Notes.pdf");
  } finally { globalThis.document=oldDocument;globalThis.location=oldLocation; }
});
