import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {mergeCandidates} from '../core.mjs';

const bridgeSource=await readFile(new URL('../capture-bridge.js',import.meta.url),'utf8');
const mainSource=await readFile(new URL('../capture-main.js',import.meta.url),'utf8');
const url='https://emergingtalent.contentcontroller.com/vault/example/guide.pdf';
const pdf=Buffer.from('%PDF-1.7\noriginal PDF bytes\n%%EOF\n');
const nonce='12345678-1234-4321-9876-123456789abc';
const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
function bridge() {
  const handlers=[];const messages=[];
  const window={addEventListener(type,handler){handlers.push(handler);},postMessage(packet){messages.push(packet);}};
  const context=vm.createContext({window,location:{origin:'https://emergingtalent.contentcontroller.com'},URL,Map,Uint8Array,ArrayBuffer,crypto:{randomUUID(){return nonce;}},Date});
  vm.runInContext(bridgeSource,context);
  const deliver=(packet,source=window,origin='https://emergingtalent.contentcontroller.com')=>handlers.forEach(handler=>handler({source,origin,data:{type:'CFS_PDF_RESPONSE',nonce,...packet}}));
  return {context,messages,deliver};
}
test('captures a complete original PDF without any new network request',()=>{
  const h=bridge();h.deliver({url,buffer:buffer(pdf),range:''});
  assert.deepEqual(Buffer.from(h.context.__courseFileSaverCaptured.get(url).bytes),pdf);
});
test('stores its own buffer rather than retaining a page-owned transferred buffer',()=>{
  const h=bridge();const pageBuffer=buffer(pdf);
  h.deliver({url,buffer:pageBuffer,range:''});
  const captured=h.context.__courseFileSaverCaptured.get(url).bytes;
  assert.notEqual(captured.buffer,pageBuffer);
  new Uint8Array(pageBuffer).fill(0);
  assert.deepEqual(Buffer.from(captured),pdf);
});
test('assembles out-of-order PDF range responses exactly and waits for all bytes',()=>{
  const h=bridge();const cut=15;
  h.deliver({url,buffer:buffer(pdf.subarray(cut)),range:`bytes ${cut}-${pdf.length-1}/${pdf.length}`});
  assert.equal(h.context.__courseFileSaverCaptured.size,0);
  h.deliver({url,buffer:buffer(pdf.subarray(0,cut)),range:`bytes 0-${cut-1}/${pdf.length}`});
  assert.deepEqual(Buffer.from(h.context.__courseFileSaverCaptured.get(url).bytes),pdf);
});
test('overlapping ranges do not cause a false complete document',()=>{
  const h=bridge();
  h.deliver({url,buffer:buffer(pdf.subarray(0,20)),range:`bytes 0-19/${pdf.length}`});
  h.deliver({url,buffer:buffer(pdf.subarray(10,25)),range:`bytes 10-24/${pdf.length}`});
  assert.equal(h.context.__courseFileSaverCaptured.size,0);
  h.deliver({url,buffer:buffer(pdf.subarray(25)),range:`bytes 25-${pdf.length-1}/${pdf.length}`});
  assert.deepEqual(Buffer.from(h.context.__courseFileSaverCaptured.get(url).bytes),pdf);
});
test('ignores forged, malformed, non-PDF and unrelated-site payloads',()=>{
  const h=bridge();
  h.deliver({url,buffer:buffer(pdf),nonce:'wrong'});
  h.deliver({url:'https://unrelated.example/file.pdf',buffer:buffer(pdf)});
  h.deliver({url,buffer:buffer(Buffer.from('<html>Login</html>'))});
  h.deliver({url,buffer:buffer(pdf),range:'bytes 0-1/2'});
  assert.equal(h.context.__courseFileSaverCaptured.size,0);
});
test('bounds completed document cache to the most recent three files',()=>{
  const h=bridge();for(let i=0;i<4;i++)h.deliver({url:url+'?file='+i,buffer:buffer(pdf)});
  assert.equal(h.context.__courseFileSaverCaptured.size,3);
  assert.ok(!h.context.__courseFileSaverCaptured.has(url+'?file=0'));
});
test('main-world fetch observer leaves request options and original response untouched',async()=>{
  const handlers=[];const messages=[];let received;
  const window={async fetch(...args){received=args;return new Response(pdf,{headers:{'content-type':'application/pdf'}});},addEventListener(type,handler){handlers.push(handler);},postMessage(packet){messages.push(packet);}};
  const context=vm.createContext({window,document:{baseURI:'https://emergingtalent.contentcontroller.com/viewer'},URL,WeakMap,ArrayBuffer,Blob});
  vm.runInContext(mainSource,context);
  for(const handler of handlers)handler({source:window,data:{type:'CFS_CAPTURE_INIT',nonce}});
  const options={headers:{Authorization:'test-private-header'},credentials:'include'};
  const response=await window.fetch(url,options);
  assert.equal(received[1],options);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);
  for(let i=0;i<10&&!messages.some(m=>m.type==='CFS_PDF_RESPONSE');i++)await new Promise(resolve=>setTimeout(resolve,5));
  const packet=messages.find(m=>m.type==='CFS_PDF_RESPONSE');
  assert.deepEqual(Buffer.from(packet.buffer),pdf);
  assert.ok(!Object.keys(packet).includes('headers'));
  assert.ok(!JSON.stringify({...packet,buffer:undefined}).includes('test-private-header'));
});
test('main-world observer does not copy unrelated JSON responses',async()=>{
  const messages=[];
  const window={async fetch(){return new Response('{"value":1}',{headers:{'content-type':'application/json'}});},addEventListener(){},postMessage(packet){messages.push(packet);}};
  const context=vm.createContext({window,document:{baseURI:'https://emergingtalent.contentcontroller.com/viewer'},URL,WeakMap,ArrayBuffer,Blob});
  vm.runInContext(mainSource,context);
  assert.equal(await (await window.fetch('https://emergingtalent.contentcontroller.com/api/session')).text(),'{"value":1}');
  assert.equal(messages.filter(m=>m.type==='CFS_PDF_RESPONSE').length,0);
});
test('prefers captured data over a detected URL that would require a fresh request',()=>{
  const contextURL='https://emergingtalent.contentcontroller.com/viewer';
  const files=mergeCandidates([{url,contextURL,kind:'resource'},{url,contextURL,kind:'captured',capturedSize:pdf.length}]);
  assert.equal(files.length,1);assert.equal(files[0].captured,true);
  assert.match(files[0].variant,/ready to save/);
});
test('accepts Firefox extension messages whose source is null only for the same origin',()=>{
  const h=bridge();
  h.deliver({url,buffer:buffer(pdf)},null,'https://unrelated.example');
  assert.equal(h.context.__courseFileSaverCaptured.size,0);
  h.deliver({url,buffer:buffer(pdf)},null,'https://emergingtalent.contentcontroller.com');
  assert.deepEqual(Buffer.from(h.context.__courseFileSaverCaptured.get(url).bytes),pdf);
});
