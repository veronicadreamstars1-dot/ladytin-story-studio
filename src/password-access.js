import {supabase} from './supabase.js';

const ERROR_ID='passwordAccessError';
const NAME_KEY='ladytin-collaborator-name';
let busy=false;

function authCard(){return document.querySelector('.auth-card')}
function passwordInput(){return document.querySelector('#appAccessPassword')}
function showError(message=''){
  const el=document.getElementById(ERROR_ID);
  if(el)el.textContent=message;
}
function renderPasswordCard(card){
  if(!card||card.dataset.passwordOnly==='true')return;
  card.dataset.passwordOnly='true';
  card.innerHTML=`<h1>LadyTin Story Studio</h1><p>Enter the shared access password.</p><label class="field"><span>Password</span><input id="appAccessPassword" type="password" autocomplete="current-password" aria-label="Password"></label><div class="action-row"><button class="btn primary" id="appAccessEnter">${busy?'Checking…':'Enter'}</button></div><p id="${ERROR_ID}" class="auth-note" style="color:var(--bad)"></p>`;
}
function patchAuthScreen(){
  const card=authCard();
  if(!card)return;
  renderPasswordCard(card);
  const button=document.querySelector('#appAccessEnter');
  if(button)button.textContent=busy?'Checking…':'Enter';
}
function patchSharedAccessChrome(){
  const projects=document.querySelector('.projects-page');
  if(projects){
    const p=projects.querySelector('.panel-head p');
    if(p)p.textContent='Shared password access';
    if(!document.getElementById('presenceName')){
      const box=document.createElement('div');
      box.className='migrate-box';
      box.innerHTML='<b>Presence name</b><p>This name is only shown to other open browser sessions. It is not used for permissions.</p><input id="presenceName" autocomplete="off" placeholder="Veronica / Tina / Collaborator">';
      projects.appendChild(box);
      const input=box.querySelector('input');
      input.value=localStorage.getItem(NAME_KEY)||'';
      input.addEventListener('input',()=>localStorage.setItem(NAME_KEY,input.value.trim()));
    }
  }
  document.querySelector('#shareProject')?.remove();
  document.querySelectorAll('.badge.role').forEach(el=>{el.textContent='shared editor';el.className='badge ok'});
}
function patchDom(){patchAuthScreen();patchSharedAccessChrome()}
async function requestAccess(password){
  const response=await fetch('/api/app-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error)throw new Error(data?.error||'Incorrect password.');
  return data;
}
async function submitPassword(){
  const input=passwordInput();
  const password=input?.value||'';
  if(!password){showError('Enter the password.');return}
  if(busy)return;
  busy=true;patchAuthScreen();showError('');
  try{
    const data=await requestAccess(password);
    if(!data?.session?.access_token||!data?.session?.refresh_token)throw new Error('The access session could not be created.');
    await supabase.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
    if(input)input.value='';
  }catch(error){
    const message=String(error?.message||'Incorrect password.');
    showError(message.includes('locked')||message.includes('configured')?message:'Incorrect password.');
  }finally{
    busy=false;patchAuthScreen();
  }
}

document.addEventListener('click',event=>{
  if(event.target?.id==='appAccessEnter'){
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    submitPassword();
  }
},true);
document.addEventListener('keydown',event=>{
  if(event.target?.id==='appAccessPassword'&&event.key==='Enter'){
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    submitPassword();
  }
},true);

new MutationObserver(patchDom).observe(document.documentElement,{childList:true,subtree:true});
patchDom();

export function collaboratorName(){return localStorage.getItem(NAME_KEY)||'Collaborator'}
