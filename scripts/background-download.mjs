import {retrieveOriginalPdf} from "./pdf-transfer.mjs";
import {isAllowedDownloadURL,isAWSAcademyURL,safeFilename} from "./core.mjs";

export async function downloadCapturedPdf(api,job,objectURLs=URL) {
  if(!Number.isInteger(job?.tabId)||!Number.isInteger(job.file?.sourceFrameId)||
     job.file?.provider!=="aws"||!job.file.captured||
     !isAllowedDownloadURL(job.file.url)||!isAWSAcademyURL(job.file.sourceOrigin)) {
    throw new Error("Reopen the guide and refresh its file list.");
  }
  const pdf=await retrieveOriginalPdf(api,job,crypto.randomUUID());
  let url;
  const blobSupported=typeof objectURLs.createObjectURL==="function";
  if(blobSupported) {
    // Zen/Firefox rejects data: downloads. Its hidden background page owns this
    // blob, so closing the popup cannot revoke it. Avoid an idle file picker.
    url=objectURLs.createObjectURL(pdf);
  }else {
    // Chrome service workers do not implement createObjectURL.
    const bytes=new Uint8Array(await pdf.arrayBuffer());
    const parts=[];
    for(let start=0;start<bytes.length;start+=8192)parts.push(String.fromCharCode(...bytes.subarray(start,start+8192)));
    url="data:application/pdf;base64,"+btoa(parts.join(""));
  }
  try {
    let id;
    try {id=await api.downloads.download({url,filename:safeFilename(job.file.filename),saveAs:false,conflictAction:"uniquify"});}
    catch{throw new Error("The browser rejected the download. Reopen the extension and try again.");}
    await waitForSavedPdf(api,id);
    return id;
  }finally {if(blobSupported)objectURLs.revokeObjectURL(url);}
}

export function waitForSavedPdf(api,id) {
  return new Promise((resolve,reject)=>{
    let finished=false;
    const cleanup=()=>{finished=true;clearInterval(poll);clearTimeout(timeout);api.downloads.onChanged.removeListener(changed);};
    const check=async()=>{
      if(finished)return;
      try {
        const [item]=await api.downloads.search({id});
        if(finished)return;
        if(item?.state==="complete"){cleanup();resolve();}
        else if(item?.state==="interrupted"){cleanup();reject(new Error("The browser interrupted the download. Check its downloads panel and try again."));}
      }catch{if(!finished){cleanup();reject(new Error("Could not verify the saved PDF. Check your browser's downloads panel."));}}
    };
    const changed=delta=>{if(delta.id===id)check();};
    const poll=setInterval(check,1000);
    const timeout=setTimeout(()=>{cleanup();reject(new Error("The download did not finish in time. Check your browser's downloads panel."));},180000);
    api.downloads.onChanged.addListener(changed);
    check();
  });
}
