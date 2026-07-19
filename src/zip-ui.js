const originalRevoke=URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL=url=>setTimeout(()=>originalRevoke(url),5000);

let activeButton=null;
let originalLabel='';

function toast(message,tone='ok'){
  const el=document.querySelector('#toast');
  if(!el)return;
  el.textContent=message;
  el.className=`toast show ${tone}`;
  setTimeout(()=>{if(el.textContent===message)el.className='toast'},4200);
}

function resetButton(){
  if(activeButton){activeButton.disabled=false;activeButton.textContent=originalLabel||activeButton.textContent;}
  activeButton=null;originalLabel='';
}

function savedSlide(index){
  try{
    const saved=JSON.parse(localStorage.getItem('ladytin-json-studio')||'{}');
    const set=saved.storySets?.[saved.activeSet||0];
    return set?.slides?.[index]||null;
  }catch{return null}
}

function begin(button){
  activeButton=button;
  originalLabel=button.textContent;
  button.disabled=true;
  button.textContent='Preparing ZIP…';
}

document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-action="package"],#downloadZip,#downloadDraft');
  if(button){
    if(button.matches('[data-action="package"]')){
      const index=Number(button.dataset.i);
      const card=button.closest('.production-card');
      if(card?.querySelector('.badge.bad')){
        event.preventDefault();event.stopImmediatePropagation();
        const slide=savedSlide(index);
        const message=slide?.main&&slide?.reference
          ?'The original uploaded file is no longer available in this browser session. Please upload it again.'
          :'Assign a main asset and design reference before downloading this slide package.';
        toast(message,'bad');
        return;
      }
    }
    begin(button);
    return;
  }

  const link=event.target.closest?.('a[download$=".zip"]');
  if(!link)return;
  if(/-slide-\d+\.zip$/i.test(link.download))link.download=link.download.replace(/\.zip$/i,'-package.zip');
  const isSlide=/-slide-\d+-package\.zip$/i.test(link.download);
  setTimeout(()=>{
    toast(isSlide?'Slide package downloaded successfully.':'Story-set package downloaded successfully.');
    resetButton();
  },50);
},true);

window.addEventListener('unhandledrejection',event=>{
  const error=event.reason instanceof Error?event.reason:new Error(String(event.reason||'Unknown ZIP error'));
  if(!/zip|package|asset|reference|browser session|assigned/i.test(error.message))return;
  event.preventDefault();
  console.error('ZIP package creation failed:',error);
  const message=/no longer available in this browser session/i.test(error.message)
    ?'The original uploaded file is no longer available in this browser session. Please upload it again.'
    :`Could not create the ZIP package: ${error.message}`;
  toast(message,'bad');
  resetButton();
});
