import {supabase} from './supabase.js';

const ERROR_ID='passwordAccessError';
const NAME_KEY='ladytin-collaborator-name';
let busy=false;

function cleanText(node,text){if(node)node.textContent=text}
function authCard(){return document.querySelector('.auth-card')}
function passwordInput(){return document.querySelector('#authEmail')}
function enterButton(){return document.querySelector('#sendLink')}
function showError(message=''){
  const card=authCard();
  if(!card)return;
  let el=document.getElementById(ERROR_ID);
  if(!el){el=document.createElement('p');el.id=ERROR_ID;el.className='auth-note';el.style.color='var(--bad)';card.appendChild(el)}
  el.textContent=message;
}
function patchAuthScreen(){
  const card=authCard();
  if(!card)return;
  const title=card.querySelector('h1');
  cleanText(title,'LadyTin Story Studio');
  const firstP=card.querySelector('p');
  cleanText(firstP,'Enter the shared access password.');
  [...card.querySelectorAll('p')].forEach((p,i)=>{if(i>0&&p.id!==ERROR_ID&&!p.classList.contains('viewer-note'))p.remove()});
  const label=card.querySelector('.field > span');
  cleanText(label,'Password');
  const input=passwordInput();
  if(input){
    input.type='password';
    input.autocomplete='current-password';
    input.placeholder='';
    input.inputMode='text';
    input.removeAttribute('value');
    input.setAttribute('aria-label','Password');
  }
  const button=enterButton();
  if(button)button.textContent=busy?'Checking…':'Enter';
}
function patchSharedAccessChrome(){
  const projects=document.querySelector('.projects-page');
  if(projects){
    const p=projects.querySelector('.panel-head p');
    cleanText(p,'Shared password access');
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
async function submitPassword(){
  const input=passwordInput();
  const password=input?.value||'';
  if(!password){showError('Enter the password.');return}
  if(busy)return;
  busy=true;patchAuthScreen();showError('');
  try{
    const {data,error}=await supabase.functions.invoke('app-access',{body:{password}});
    if(error||data?.error)throw new Error(data?.error||error?.message||'Incorrect password.');
    if(!data?.session?.access_token||!data?.session?.refresh_token)throw new Error('The access session could not be created.');
    await supabase.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
    if(input)input.value='';
  }catch(error){
    showError(error.message.includes('locked')?error.message:'Incorrect password.');
  }finally{
    busy=false;patchAuthScreen();
  }
}

document.addEventListener('click',event=>{
  if(event.target?.id==='sendLink'){
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    submitPassword();
  }
},true);
document.addEventListener('keydown',event=>{
  if(event.target?.id==='authEmail'&&event.key==='Enter'){
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    submitPassword();
  }
},true);

new MutationObserver(patchDom).observe(document.documentElement,{childList:true,subtree:true});
patchDom();

export function collaboratorName(){return localStorage.getItem(NAME_KEY)||'Collaborator'}
