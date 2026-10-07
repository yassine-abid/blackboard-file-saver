import test from 'node:test';
import assert from 'node:assert/strict';
import {filesFromCandidate,mergeCandidates,isSupportedPageURL} from '../core.mjs';
import {scanTab,missingAWSAccess,AWS_GUIDE_ORIGINS} from '../browser-api.mjs';
import {collectFrameCandidates} from '../scanner.mjs';

const contextURL='https://emergingtalent.contentcontroller.com/ScormEngineInterface/defaultui/player/cmi5-au/1.0/html/cmi5-mediaFile.html';
const pdf='https://emergingtalent.contentcontroller.com/vault/example/ACSFv1-EN-SG-M02.pdf?token=opaque%2B%2F%3D';

test('recognizes the AWS Academy course and its explicitly supported nested viewers',()=>{
  assert.ok(isSupportedPageURL('https://awsacademy.instructure.com/courses/123/modules/items/456'));
  assert.ok(isSupportedPageURL(contextURL));
  assert.equal(isSupportedPageURL('https://other.instructure.com/courses/123'),false);
  assert.equal(isSupportedPageURL('https://contentcontroller.com.evil.example/guide.pdf'),false);
});
test('finds a complete original PDF loaded by an AWS SCORM frame',()=>{
  const files=filesFromCandidate({url:pdf,contextURL,kind:'resource',label:'Student Guide'});
  assert.equal(files.length,1);
  assert.equal(files[0].filename,'ACSFv1-EN-SG-M02.pdf');
  assert.equal(files[0].url,pdf);
  assert.equal(files[0].variant,'Original AWS Academy PDF');
});
test('accepts loaded AWS storage PDFs but excludes external citation links and unrelated contexts',()=>{
  const source='https://course-assets.cloudfront.net/student-guide.pdf?signature=opaque';
  assert.equal(filesFromCandidate({url:source,contextURL,kind:'resource'}).length,1);
  assert.deepEqual(filesFromCandidate({url:source,contextURL,kind:'a'}),[]);
  assert.deepEqual(filesFromCandidate({url:source,contextURL:'https://unrelated.example/',kind:'resource'}),[]);
  assert.deepEqual(filesFromCandidate({url:'https://malicious.example/guide.pdf',contextURL,kind:'resource'}),[]);
});
test('does not turn SCORM launch secrets or other resource URLs into downloadable files',()=>{
  for(const url of [contextURL+'?fetch=secret','https://emergingtalent.contentcontroller.com/api/launch/config','https://emergingtalent.contentcontroller.com/engine.js']) {
    assert.deepEqual(filesFromCandidate({url,contextURL,kind:'resource'}),[]);
  }
});
test('deduplicates a PDF that is present both in DOM references and resource timing',()=>{
  assert.equal(mergeCandidates([{url:pdf,contextURL,kind:'a'},{url:pdf,contextURL,kind:'resource'}]).length,1);
});
test('scanner reads loaded PDF resource names without reading bodies or authentication storage',()=>{
  const originals={document:globalThis.document,location:globalThis.location,performance:globalThis.performance};
  globalThis.location={href:contextURL,hostname:'emergingtalent.contentcontroller.com'};
  globalThis.document={title:'Student Guide',baseURI:contextURL,querySelectorAll(){return [];}};
  Object.defineProperty(globalThis,'performance',{value:{getEntriesByType(type){assert.equal(type,'resource');return [{name:pdf},{name:'https://emergingtalent.contentcontroller.com/engine.js'},{name:'https://emergingtalent.contentcontroller.com/api/launch?token=secret'}];}},configurable:true});
  try {
    const resources=collectFrameCandidates().filter(c=>c.kind==='resource');
    assert.deepEqual(resources,[{url:pdf,label:'Student Guide',kind:'resource',contextURL}]);
  } finally {
    globalThis.document=originals.document;globalThis.location=originals.location;
    Object.defineProperty(globalThis,'performance',{value:originals.performance,configurable:true});
  }
});
test('frame discovery scans AWS Academy and nested SCORM frames separately',async()=>{
  const scanned=[];
  const api={webNavigation:{async getAllFrames(){return [{frameId:0,url:'https://awsacademy.instructure.com/courses/123'},{frameId:4,url:contextURL},{frameId:8,url:'https://unrelated.example/'}];}},scripting:{async executeScript({target}){scanned.push(target.frameIds[0]);return [{result:target.frameIds[0]===4?[{url:pdf,contextURL,kind:'resource'}]:[]}];}}};
  const result=await scanTab(api,7);
  assert.deepEqual(scanned,[0,4]);
  assert.equal(result.files.length,1);
});

test('identifies missing viewer grants even when the course tab itself can be read',async()=>{
  const api={permissions:{async contains({origins}){return origins[0]===AWS_GUIDE_ORIGINS[0];}}};
  assert.deepEqual(await missingAWSAccess(api),AWS_GUIDE_ORIGINS.slice(1));
});
test('reports no missing access after every supported AWS origin is granted',async()=>{
  const api={permissions:{async contains(){return true;}}};
  assert.deepEqual(await missingAWSAccess(api),[]);
});
test('reports a denied frame using its hostname without leaking a launch token',async()=>{
  const api={webNavigation:{async getAllFrames(){return [{frameId:4,url:contextURL+'?launch=PRIVATE'}];}},scripting:{async executeScript(){throw new Error('Missing host permission for '+contextURL+'?launch=PRIVATE');}}};
  const result=await scanTab(api,7);
  assert.equal(result.inaccessibleFrames,1);
  assert.deepEqual(result.blockedFrames,[{host:'emergingtalent.contentcontroller.com',reason:'Browser access was denied.'}]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('detects Firefox per-frame script failures returned inside a fulfilled injection',async()=>{
  const api={webNavigation:{async getAllFrames(){return [{frameId:4,url:contextURL}];}},scripting:{async executeScript(){return [{frameId:4,error:{message:'The scan failed'}}];}}};
  const result=await scanTab(api,7);
  assert.equal(result.inaccessibleFrames,1);
  assert.equal(result.files.length,0);
  assert.equal(result.blockedFrames.length,1);
});
