import {downloadCapturedPdf} from "./background-download.mjs";

const api=globalThis.browser||globalThis.chrome;
api.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=="CFS_DOWNLOAD_PDF"||sender.id!==api.runtime.id||sender.url!==api.runtime.getURL("popup/popup.html"))return;
  downloadCapturedPdf(api,{tabId:message.tabId,file:message.file})
    .then(downloadId=>respond({ok:true,downloadId}))
    .catch(error=>respond({ok:false,error:error instanceof Error?error.message:"The PDF could not be saved."}));
  // Keep the request alive even if the action popup closes during Save As.
  return true;
});
