import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {retrieveOriginalPdf,preparePdfTransfer} from '../pdf-transfer.mjs';
import {scanTab,startDownload} from '../browser-api.mjs';
import {downloadCapturedPdf} from '../background-download.mjs';

const origin='https://emergingtalent.contentcontroller.com';
const url=origin+'/vault/example/guide.pdf';
const job={tabId:42,file:{url,filename:'guide.pdf',sourceFrameId:7,sourceOrigin:origin,provider:'aws'}};
const id='12345678-1234-4321-9876-123456789abc';
function harness(bytes,{status=200,headers={},frameOrigin=origin}={}) {
  const requests=[];
  const timers=new Map();let timerId=0;
  const context=vm.createContext({location:{origin:frameOrigin},URL,Uint8Array,Map,AbortController,btoa,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    async fetch(source,options){requests.push({source,options});return new Response(bytes,{status,headers});}
  });
  const api={scripting:{async executeScript({func,args,target,world}){
    assert.equal(target.tabId,42);assert.deepEqual(target.frameIds,[7]);assert.equal(world,'ISOLATED');
    context.__args=args;
    const result=await vm.runInContext(`(${func.toString()})(...__args)`,context);
    return [{frameId:7,result}];
  }}};
  return {api,context,requests,timers};
}
const pdf=Buffer.from('%PDF-1.7\nexample original document\n%%EOF\n');
test('retrieves exact PDF bytes in the source frame using its cookie/cache context',async()=>{
  const h=harness(pdf);
  const blob=await retrieveOriginalPdf(h.api,job,id);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),pdf);
  assert.equal(blob.type,'application/pdf');
  assert.equal(h.requests[0].source,url);
  assert.equal(h.requests[0].options.credentials,'include');
  assert.equal(h.requests[0].options.cache,'force-cache');
  assert.equal(h.context.__courseFileSaverTransfers.size,0);
  assert.equal(h.timers.size,0);
});
test('transfers multiple bounded chunks without corrupting binary data',async()=>{
  const bytes=Buffer.alloc(1100000);
  for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  pdf.subarray(0,9).copy(bytes);
  Buffer.from('\n%%EOF\n').copy(bytes,bytes.length-7);
  const h=harness(bytes);const progress=[];
  const blob=await retrieveOriginalPdf(h.api,job,id,message=>progress.push(message));
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
  assert.ok(progress.some(message=>message.includes('100%')));
  assert.equal(h.context.__courseFileSaverTransfers.size,0);
});
test('rejects login HTML even when the server returns HTTP 200',async()=>{
  const h=harness('<html>Sign in</html>');
  await assert.rejects(retrieveOriginalPdf(h.api,job,id),/non-PDF/);
  assert.equal(h.timers.size,0);
});
test('rejects an incomplete PDF without its end marker',async()=>{
  const h=harness('%PDF-1.7\nfirst partial segment');
  await assert.rejects(retrieveOriginalPdf(h.api,job,id),/part of the PDF/);
});
test('reports HTTP errors without returning a false successful download',async()=>{
  const h=harness('Forbidden',{status:403});
  await assert.rejects(retrieveOriginalPdf(h.api,job,id),/returned 403/);
});
test('rejects a partial HTTP range response even when it contains PDF markers',async()=>{
  const h=harness(pdf,{status:206,headers:{'content-range':`bytes 0-${pdf.length-1}/${pdf.length+100}`}});
  await assert.rejects(retrieveOriginalPdf(h.api,job,id),/part of the PDF/);
});
test('accepts a complete range response only when its declared total matches the bytes',async()=>{
  const h=harness(pdf,{status:206,headers:{'content-range':`bytes 0-${pdf.length-1}/${pdf.length}`}});
  assert.deepEqual(Buffer.from(await (await retrieveOriginalPdf(h.api,job,id)).arrayBuffer()),pdf);
});
test('refuses to fetch after the source frame changes to a different origin',async()=>{
  const h=harness(pdf,{frameOrigin:'https://unrelated.example'});
  await assert.rejects(retrieveOriginalPdf(h.api,job,id),/guide page changed/);
  assert.equal(h.requests.length,0);
});
test('never fetches an unrelated source address',async()=>{
  const h=harness(pdf);
  const result=await h.api.scripting.executeScript({target:{tabId:42,frameIds:[7]},world:'ISOLATED',func:preparePdfTransfer,args:['https://unrelated.example/file.pdf',id,origin]});
  assert.equal(result[0].result.ok,false);
  assert.equal(h.requests.length,0);
});
test('redacts browser injection errors instead of displaying a launch URL',async()=>{
  const api={scripting:{async executeScript(){throw new Error(origin+'?secret=PRIVATE');}}};
  await assert.rejects(retrieveOriginalPdf(api,job,id),error=>!error.message.includes('PRIVATE')&&/guide was closed/.test(error.message));
});
test('AWS download runs in the background without creating a tab or disk handoff',async()=>{
  let message;
  const api={runtime:{async sendMessage(value){message=value;return {ok:true,downloadId:123};}},tabs:{create(){throw new Error('No helper tab allowed');}}};
  assert.deepEqual(await startDownload(api,{...job.file,captured:true},42),{kind:'background-download',downloadId:123});
  assert.equal(message.type,'CFS_DOWNLOAD_PDF');
  assert.equal(message.tabId,42);
  assert.equal(message.file.url,url);
});
test('reports a background transfer failure to the popup',async()=>{
  const api={runtime:{async sendMessage(){return {ok:false,error:'Reload the guide'};}}};
  await assert.rejects(startDownload(api,job.file,42),/Reload the guide/);
});
test('Chrome background download preserves binary bytes without an extra page or a blob URL',async()=>{
  const bytes=Buffer.alloc(1100000);
  for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  pdf.subarray(0,9).copy(bytes);
  Buffer.from('%%EOF').copy(bytes,bytes.length-5);
  const h=harness('Forbidden',{status:403});
  h.context.__courseFileSaverCaptured=new Map([[url,{bytes:new Uint8Array(bytes)}]]);
  let saved;
  h.api.downloads={async download(options){saved=options;return 123;},async search(){return [{state:'complete'}];},onChanged:{addListener(){},removeListener(){}}};
  assert.equal(await downloadCapturedPdf(h.api,{...job,file:{...job.file,captured:true}},{}),123);
  assert.equal(saved.filename,'guide.pdf');
  assert.equal(saved.saveAs,false);
  assert.ok(saved.url.startsWith('data:application/pdf;base64,'));
  assert.deepEqual(Buffer.from(saved.url.split(',')[1],'base64'),bytes);
  assert.equal(h.requests.length,0);
  assert.equal(h.context.__courseFileSaverTransfers.size,0);
});
test('background rejects a missing capture and an unrelated frame before copying',async()=>{
  const h=harness(pdf);
  await assert.rejects(downloadCapturedPdf(h.api,job),/Reopen the guide/);
  await assert.rejects(downloadCapturedPdf(h.api,{...job,file:{...job.file,captured:true,sourceOrigin:'https://unrelated.example'}}),/Reopen the guide/);
  assert.equal(h.requests.length,0);
});
test('retains the resource-loading frame for an AWS PDF',async()=>{
  const api={webNavigation:{async getAllFrames(){return [{frameId:0,url:'https://awsacademy.instructure.com/courses/example'},{frameId:7,url:origin+'/viewer'}];}},scripting:{async executeScript({target}){return [{result:target.frameIds[0]===7?[{url,contextURL:origin+'/viewer',kind:'resource'}]:[]}];}}};
  const result=await scanTab(api,42);
  assert.equal(result.files[0].sourceFrameId,7);
  assert.equal(result.files[0].sourceOrigin,origin);
});
test('copies captured PDF bytes even when a fresh fetch would fail',async()=>{
  const h=harness('Forbidden',{status:403});
  h.context.__courseFileSaverCaptured=new Map([[url,{bytes:new Uint8Array(pdf)}]]);
  const blob=await retrieveOriginalPdf(h.api,job,id);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),pdf);
  assert.equal(h.requests.length,0);
  assert.equal(h.context.__courseFileSaverTransfers.size,0);
});

test('Firefox background owns the blob until the browser confirms completion',async()=>{
  const h=harness('Forbidden',{status:403});
  h.context.__courseFileSaverCaptured=new Map([[url,{bytes:new Uint8Array(pdf)}]]);
  let created,revoked,changed,resolveSearch;
  const objectURLs={createObjectURL(blob){created=blob;return 'blob:moz-extension://test/pdf';},revokeObjectURL(value){revoked=value;}};
  h.api.downloads={
    async download(options){assert.equal(options.url,'blob:moz-extension://test/pdf');assert.equal(options.saveAs,false);return 321;},
    async search(){return new Promise(resolve=>{resolveSearch=resolve;});},
    onChanged:{addListener(fn){changed=fn;},removeListener(fn){assert.equal(fn,changed);changed=undefined;}}
  };
  const saving=downloadCapturedPdf(h.api,{...job,file:{...job.file,captured:true}},objectURLs);
  for(let i=0;i<20&&!resolveSearch;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(resolveSearch);
  assert.deepEqual(Buffer.from(await created.arrayBuffer()),pdf);
  assert.equal(revoked,undefined);
  resolveSearch([{state:'complete'}]);
  assert.equal(await saving,321);
  assert.equal(revoked,'blob:moz-extension://test/pdf');
  assert.equal(changed,undefined);
});
test('a failed Firefox save revokes its background blob and reports an interrupted download',async()=>{
  const h=harness(pdf);let revoked;
  const objectURLs={createObjectURL(){return 'blob:moz-extension://test/pdf';},revokeObjectURL(value){revoked=value;}};
  h.api.downloads={async download(){return 321;},async search(){return [{state:'interrupted'}];},onChanged:{addListener(){},removeListener(){}}};
  await assert.rejects(downloadCapturedPdf(h.api,{...job,file:{...job.file,captured:true}},objectURLs),/interrupted/);
  assert.equal(revoked,'blob:moz-extension://test/pdf');
});
