// Run only in permitted course/viewer frames. Responses are copied without
// altering the viewer's request, headers, authentication, or response body.
(() => {
  if (window.__courseFileSaverCaptureInstalled) return;
  window.__courseFileSaverCaptureInstalled = true;
  window.__courseFileSaverCaptureVersion = "1.1.8";
  let nonce;
  const pending = [];
  function send(packet) {
    if (!nonce) {if (pending.length < 20) pending.push(packet);return;}
    window.postMessage({...packet,type:"CFS_PDF_RESPONSE",nonce},"*",[packet.buffer]);
  }
  window.addEventListener("message",event=>{
    const ownSender=event.source===window||(event.source===null&&(event.origin===location.origin||event.origin===window.origin));
    if(!ownSender||event.data?.type!=="CFS_CAPTURE_INIT"||typeof event.data.nonce!=="string"||event.data.nonce.length<20)return;
    nonce=event.data.nonce;
    for(const packet of pending.splice(0))send(packet);
  });
  function pdfRequest(url,mime) {
    try {
      const source=new URL(url,document.baseURI);
      const host=source.hostname;
      const allowed=host==="emergingtalent.contentcontroller.com"||host==="awsacademy.contentcontroller.com"||host.endsWith(".cloudfront.net")||host.endsWith(".amazonaws.com");
      return source.protocol==="https:"&&allowed&&(/\.pdf$/i.test(source.pathname)||/^application\/pdf(?:;|$)/i.test(mime||"")) ? source.href : null;
    }catch{return null;}
  }
  const originalFetch=window.fetch;
  if(typeof originalFetch==="function") {
    window.fetch=function(...args) {
      return originalFetch.apply(this,args).then(response=>{
        try {
          const input=typeof args[0]==="string"?args[0]:args[0]?.url||String(args[0]);
          const url=pdfRequest(input,response.headers.get("content-type"));
          if(url&&response.ok) {
            const copy=response.clone();
            const range=response.headers.get("content-range")||"";
            copy.arrayBuffer().then(buffer=>{if(buffer.byteLength<=128*1024*1024)send({url,range,buffer});}).catch(()=>{});
          }
        }catch{/* The original response always remains available to the viewer. */}
        return response;
      });
    };
  }
  const requests=new WeakMap();
  const prototype=window.XMLHttpRequest?.prototype;
  if(prototype) {
    const originalOpen=prototype.open,originalSend=prototype.send;
    prototype.open=function(method,url,...args) {
      try{requests.set(this,new URL(String(url),document.baseURI).href);}catch{requests.delete(this);}
      return originalOpen.call(this,method,url,...args);
    };
    prototype.send=function(...args) {
      this.addEventListener("load",()=>{
        try {
          const url=pdfRequest(requests.get(this),this.getResponseHeader("content-type"));
          if(!url||this.status<200||this.status>=300)return;
          const range=this.getResponseHeader("content-range")||"";
          if(this.response instanceof ArrayBuffer) {
            const buffer=this.response.slice(0);
            if(buffer.byteLength<=128*1024*1024)send({url,range,buffer});
          } else if(this.response instanceof Blob&&this.response.size<=128*1024*1024) {
            this.response.arrayBuffer().then(buffer=>send({url,range,buffer})).catch(()=>{});
          }
        }catch{/* Never affect the viewer's original load event. */}
      },{once:true});
      return originalSend.apply(this,args);
    };
  }
  window.postMessage({type:"CFS_CAPTURE_READY"},"*");
})();
