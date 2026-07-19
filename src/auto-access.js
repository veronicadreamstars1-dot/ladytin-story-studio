import {supabase,isConfigured} from './supabase.js';

let started=false;

function replaceAuthCopy(message='Opening LadyTin Story Studio…',isError=false){
  const card=document.querySelector('.auth-card');
  if(!card||card.dataset.autoAccess==='true')return;
  card.dataset.autoAccess='true';
  card.innerHTML=`<h1>LadyTin Story Studio</h1><p class="auth-note" style="${isError?'color:var(--bad)':''}">${message}</p>`;
}

function watchAuthScreen(){
  const patch=()=>replaceAuthCopy();
  new MutationObserver(patch).observe(document.documentElement,{childList:true,subtree:true});
  patch();
}

async function enterAnonymously(){
  if(started||!isConfigured()||!supabase)return;
  started=true;
  watchAuthScreen();
  const {data}=await supabase.auth.getSession();
  if(data?.session)return;
  const {error}=await supabase.auth.signInAnonymously();
  if(error){
    console.error('Anonymous access failed:',error);
    replaceAuthCopy('Anonymous access is not enabled in Supabase. Enable Authentication → Sign In / Providers → Anonymous sign-ins, then refresh.',true);
  }
}

enterAnonymously();
