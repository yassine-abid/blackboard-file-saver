// The page-world observer forwards only PDF response bytes. Keep them in this
// extension's isolated frame memory; no authentication headers or disk storage.
(() => {
  if(globalThis.__courseFileSaverBridgeInstalled)return;
  globalThis.__courseFileSaverBridgeInstalled=true;
  const nonce=typeof crypto.randomUUID==="function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("");
  const completed=globalThis.__courseFileSaverCaptured||(globalThis.__courseFileSaverCaptured=new Map());
  const assembling=new Map();
  const max=128*1024*1024;
  function validPDF(bytes) {
    return String.fromCharCode(...bytes.slice(0,5))==="%PDF-"&&String.fromCharCode(...bytes.slice(-2048)).includes("%%EOF");
  }
  function store(url,bytes) {
    if(!validPDF(bytes))return;
    completed.delete(url);
    completed.set(url,{bytes,capturedAt:Date.now()});
    while(completed.size>3)completed.delete(completed.keys().next().value);
    assembling.delete(url);
  }
  function init(){window.postMessage({type:"CFS_CAPTURE_INIT",nonce},"*");}
  window.addEventListener("message",event=>{
    const ownSender=event.source===window||(event.source===null&&(event.origin===location.origin||event.origin===window.origin));
    if(!ownSender)return;
    const data=event.data;
    if(data?.type==="CFS_CAPTURE_READY"){init();return;}
    if(data?.type!=="CFS_PDF_RESPONSE"||data.nonce!==nonce||Object.prototype.toString.call(data.buffer)!=="[object ArrayBuffer]")return;
    try {
      const source=new URL(data.url);
      const host=source.hostname;
      const allowed=host==="emergingtalent.contentcontroller.com"||host==="awsacademy.contentcontroller.com"||host.endsWith(".cloudfront.net")||host.endsWith(".amazonaws.com");
      if(source.protocol!=="https:"||source.username||source.password||!allowed||data.buffer.byteLength>max)return;
      // Firefox wraps page-owned buffers. Copy into extension-owned storage
      // before slice() consults the backing buffer's inaccessible constructor.
      const bytes=new Uint8Array(data.buffer.byteLength);
      bytes.set(new Uint8Array(data.buffer));
      if(!data.range){store(source.href,bytes);return;}
      const range=String(data.range).match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if(!range)return;
      const start=Number(range[1]),end=Number(range[2])+1,total=Number(range[3]);
      if(total<=0||total>max||end>total||start>=end||bytes.length!==end-start)return;
      let entry=assembling.get(source.href);
      if(!entry||entry.bytes.length!==total){entry={bytes:new Uint8Array(total),ranges:[]};assembling.set(source.href,entry);}
      entry.bytes.set(bytes,start);
      entry.ranges.push([start,end]);
      entry.ranges.sort((a,b)=>a[0]-b[0]);
      const merged=[];
      for(const interval of entry.ranges){const last=merged.at(-1);if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else merged.push([...interval]);}
      entry.ranges=merged;
      if(merged.length===1&&merged[0][0]===0&&merged[0][1]===total)store(source.href,entry.bytes);
      while(assembling.size>3)assembling.delete(assembling.keys().next().value);
    }catch{/* Ignore malformed or unrelated page messages. */}
  });
  init();
})();
