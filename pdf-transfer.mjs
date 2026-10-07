// Each function is self-contained because scripting.executeScript serializes it.
// Only the explicitly selected PDF is fetched, within its original viewer frame.
export async function preparePdfTransfer(url, id, expectedOrigin) {
  const allowed = ["https://awsacademy.instructure.com","https://emergingtalent.contentcontroller.com","https://awsacademy.contentcontroller.com"];
  if (!allowed.includes(expectedOrigin) || location.origin !== expectedOrigin) return {ok:false,code:"FRAME_CHANGED"};
  try {
    const source = new URL(url);
    const host = source.hostname;
    const permitted = allowed.includes(source.origin) || host.endsWith(".cloudfront.net") || host.endsWith(".amazonaws.com");
    if (source.protocol !== "https:" || source.username || source.password || !permitted) return {ok:false,code:"UNSUPPORTED_SOURCE"};
  } catch { return {ok:false,code:"UNSUPPORTED_SOURCE"}; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const captured=globalThis.__courseFileSaverCaptured?.get(url);
    if(captured?.bytes) {
      const bytes=captured.bytes;
      const store=globalThis.__courseFileSaverTransfers||(globalThis.__courseFileSaverTransfers=new Map());
      if(store.has(id))clearTimeout(store.get(id).expiry);
      const expiry=setTimeout(()=>store.delete(id),600000);
      store.set(id,{bytes,expiry});
      return {ok:true,size:bytes.byteLength,chunks:Math.ceil(bytes.byteLength/(512*1024)),captured:true};
    }
    const response = await fetch(url,{credentials:"include",cache:"force-cache",signal:controller.signal});
    if (!response.ok) return {ok:false,code:`HTTP_${response.status}`};
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 128 * 1024 * 1024) return {ok:false,code:"TOO_LARGE"};
    if (String.fromCharCode(...bytes.slice(0,5)) !== "%PDF-") return {ok:false,code:"NOT_PDF"};
    const tail = String.fromCharCode(...bytes.slice(-2048));
    if (!tail.includes("%%EOF")) return {ok:false,code:"INCOMPLETE_PDF"};
    if (response.status === 206) {
      const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range || Number(range[1]) !== 0 || Number(range[2])+1 !== Number(range[3]) || bytes.byteLength !== Number(range[3])) return {ok:false,code:"INCOMPLETE_PDF"};
    }
    const store = globalThis.__courseFileSaverTransfers || (globalThis.__courseFileSaverTransfers = new Map());
    if (store.has(id)) clearTimeout(store.get(id).expiry);
    const expiry = setTimeout(() => store.delete(id), 600000);
    store.set(id,{bytes,expiry});
    const chunkSize = 512 * 1024;
    return {ok:true,size:bytes.byteLength,chunks:Math.ceil(bytes.byteLength/chunkSize)};
  } catch { return {ok:false,code:controller.signal.aborted ? "TIMEOUT" : "NO_CAPTURED_PDF"}; }
  finally { clearTimeout(timeout); }
}

export function readPdfTransferChunk(id, index) {
  const entry = globalThis.__courseFileSaverTransfers?.get(id);
  if (!entry || !Number.isInteger(index) || index < 0) return {ok:false,code:"TRANSFER_EXPIRED"};
  const chunkSize = 512 * 1024;
  const start = index * chunkSize;
  if (start >= entry.bytes.length) return {ok:false,code:"INVALID_CHUNK"};
  const bytes = entry.bytes.subarray(start,Math.min(start+chunkSize,entry.bytes.length));
  let binary = "";
  for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return {ok:true,data:btoa(binary)};
}

export function clearPdfTransfer(id) {
  const store = globalThis.__courseFileSaverTransfers;
  const entry = store?.get(id);
  if (entry) {clearTimeout(entry.expiry);store.delete(id);}
}

export function transferError(code) {
  if (/^HTTP_\d+$/.test(code)) return `The guide's file server returned ${code.slice(5)}. Reopen the Student Guide and try again.`;
  return {
    FRAME_CHANGED:"The guide page changed. Reopen it and refresh the extension's file list.",
    UNSUPPORTED_SOURCE:"This file address is not supported.",
    NOT_PDF:"The server returned a login or other non-PDF response. No file was saved. Reopen the guide and try again.",
    INCOMPLETE_PDF:"The response was only part of the PDF. No incomplete file was saved.",
    TOO_LARGE:"This PDF exceeds the current 128 MB transfer limit.",
    TIMEOUT:"The viewer's PDF request timed out. Reopen the guide and try again.",
    TRANSFER_EXPIRED:"The guide was closed, changed, or the transfer expired. Reopen it and try again.",
    NO_CAPTURED_PDF:"Reload the Student Guide page once, wait for its pages to appear, then reopen the extension. It needs to capture the original PDF response while the guide loads."
  }[code] || "The PDF transfer failed. Reopen the guide and try again.";
}

export async function retrieveOriginalPdf(api, job, id, progress = () => {}) {
  const target = {tabId:job.tabId,frameIds:[job.file.sourceFrameId]};
  async function invoke(func,args) {
    let results;
    try {results = await api.scripting.executeScript({target,world:"ISOLATED",func,args});}
    catch {throw new Error(transferError("TRANSFER_EXPIRED"));}
    const result = results.find(r => r.frameId === job.file.sourceFrameId) || results[0];
    if (!result || result.error || !result.result) throw new Error(transferError("TRANSFER_EXPIRED"));
    return result.result;
  }
  try {
    progress("Copying the original PDF from your guide's viewer…");
    const metadata = await invoke(preparePdfTransfer,[job.file.url,id,job.file.sourceOrigin]);
    if (!metadata.ok) throw new Error(transferError(metadata.code));
    const parts = [];
    let received = 0;
    for(let index=0;index<metadata.chunks;index++) {
      const chunk = await invoke(readPdfTransferChunk,[id,index]);
      if (!chunk.ok) throw new Error(transferError(chunk.code));
      const binary = atob(chunk.data);
      const bytes = Uint8Array.from(binary,c=>c.charCodeAt(0));
      received += bytes.byteLength;
      parts.push(bytes);
      progress(`Copying original PDF: ${Math.round(received/metadata.size*100)}%`);
    }
    if (received !== metadata.size) throw new Error("The PDF transfer was incomplete. No file was saved.");
    return new Blob(parts,{type:"application/pdf"});
  } finally {
    try {await api.scripting.executeScript({target,world:"ISOLATED",func:clearPdfTransfer,args:[id]});} catch { /* Navigating the guide also destroys its isolated transfer buffer. */ }
  }
}
