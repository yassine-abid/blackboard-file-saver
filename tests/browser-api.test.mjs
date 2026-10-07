import test from "node:test";
import assert from "node:assert/strict";
import { scanTab, startDownload } from "../browser-api.mjs";

const pdf="https://prod.files.blackboard.com/opaque/file?"+new URLSearchParams({"response-content-disposition":"attachment; filename*=UTF-8''course.pdf"});
const viewer="https://basic-doc-viewer.eu.api.blackboard.com/ui/doc?"+new URLSearchParams({pdfUrl:pdf});
test("one inaccessible frame does not hide a loaded cross-origin viewer", async()=>{
  const calls=[];
  const api={webNavigation:{async getAllFrames({tabId}){assert.equal(tabId,42);return [
    {frameId:0,url:"https://esprit.blackboard.com/ultra/course"},
    {frameId:5,url:viewer},
    {frameId:8,url:"https://analytics.example.com/telemetry"}
  ];}},scripting:{async executeScript(options){calls.push(options);if(options.target.frameIds[0]===0)throw new Error("Frame navigated");return [{frameId:5,result:[{url:viewer,label:"Document Rendering"}]}];}}};
  const result=await scanTab(api,42);
  assert.equal(result.files.length,1);
  assert.equal(result.files[0].url,pdf);
  assert.equal(result.inaccessibleFrames,1);
  assert.deepEqual(calls.map(c=>c.target.frameIds),[[0],[5]]);
  assert.ok(calls.every(c=>c.world==="ISOLATED"));
});
test("initiates a user-selected download with a safe filename and Save As",async()=>{
  let options;
  const api={downloads:{async download(value){options=value;return 123;}}};
  assert.equal(await startDownload(api,{url:pdf,filename:"course.pdf"}),123);
  assert.deepEqual(options,{url:pdf,filename:"course.pdf",saveAs:true,conflictAction:"uniquify"});
});
test("refuses an unrelated download address before calling the browser",async()=>{
  const api={downloads:{download(){throw new Error("must not call");}}};
  await assert.rejects(startDownload(api,{url:"https://other.example/file.pdf",filename:"file.pdf"}));
});
test("returns an empty list when there are no permitted frames",async()=>{
  const api={webNavigation:{async getAllFrames(){return undefined;}},scripting:{executeScript(){throw new Error("must not call");}}};
  assert.deepEqual(await scanTab(api,1),{files:[],inaccessibleFrames:0,blockedFrames:[]});
});
