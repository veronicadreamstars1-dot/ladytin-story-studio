import{supabase}from'./supabase.js';
import{SUPABASE_PUBLISHABLE_KEY,SUPABASE_URL,isConfigured}from'./config.js';
import{isValidSharedUser,sharedLoginError,sharedLoginPayload,sharedSessionExpiry}from'./shared-auth-core.js';

const FUNCTION_URL=()=>`${SUPABASE_URL}/functions/v1/shared-access`;
let expiryTimer=null;

function renderPasswordScreen(){
  document.documentElement.dataset.sharedAuth='locked';
  document.body.innerHTML=`<div class="auth-shell shared-auth-shell"><form class="auth-card shared-auth-card" id="sharedAuthForm" novalidate><h1>LadyTin Story Studio</h1><label class="field shared-password-field"><span>Password</span><input id="sharedPassword" type="password" autocomplete="current-password" required autofocus></label><button class="btn primary shared-enter" id="sharedEnter" type="submit">Enter</button><p class="auth-note shared-auth-error" id="sharedAuthError" role="alert" aria-live="polite"></p></form></div>`;
}
function scheduleExpiry(user){
  clearTimeout(expiryTimer);
  const remaining=sharedSessionExpiry(user)-Date.now();
  if(remaining<=0)return;
  expiryTimer=setTimeout(async()=>{await supabase.auth.signOut();location.reload()},Math.min(remaining,2147483647));
}
async function existingSharedUser(){
  const{data,error}=await supabase.auth.getUser();
  if(error||!isValidSharedUser(data?.user))return null;
  scheduleExpiry(data.user);
  return data.user;
}
async function callSharedAccess(body,accessToken=''){
  const response=await fetch(FUNCTION_URL(),{
    method:'POST',
    headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY,...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},
    body:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(sharedLoginError(response.status,data));
  return data;
}
async function createSharedSession(password){
  const verified=await callSharedAccess({action:'verify',...sharedLoginPayload(password)});
  if(!verified.ticket)throw new Error('Could not create the application session.');
  await supabase.auth.signOut();
  const{data:anonymous,error:anonymousError}=await supabase.auth.signInAnonymously();
  if(anonymousError||!anonymous?.session?.access_token)throw new Error('Password access is not enabled correctly.');
  try{
    await callSharedAccess({action:'activate',ticket:verified.ticket},anonymous.session.access_token);
    const{data:refreshed,error:refreshError}=await supabase.auth.refreshSession();
    if(refreshError||!refreshed?.user||!isValidSharedUser(refreshed.user))throw new Error('Could not verify the application session.');
    scheduleExpiry(refreshed.user);
    return refreshed.user;
  }catch(error){
    await supabase.auth.signOut();
    throw error;
  }
}
export async function ensureSharedSession(){
  if(!isConfigured())return null;
  const existing=await existingSharedUser();
  if(existing){delete document.documentElement.dataset.sharedAuth;return existing}
  await supabase.auth.signOut();
  renderPasswordScreen();
  const form=document.querySelector('#sharedAuthForm');
  const input=document.querySelector('#sharedPassword');
  const button=document.querySelector('#sharedEnter');
  const error=document.querySelector('#sharedAuthError');
  return new Promise(resolve=>{
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const password=input.value;
      input.value='';
      error.textContent='';
      button.disabled=true;
      button.textContent='Entering…';
      try{
        const user=await createSharedSession(password);
        delete document.documentElement.dataset.sharedAuth;
        resolve(user);
      }catch(authError){
        error.textContent=authError instanceof Error?authError.message:'Incorrect password.';
        button.disabled=false;
        button.textContent='Enter';
        input.focus();
      }
    });
  });
}
