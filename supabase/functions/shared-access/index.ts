import {createClient} from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')??'';
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const SESSION_HOURS=12;
const TICKET_SECONDS=120;
const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

function corsHeaders(req:Request){
  const origin=req.headers.get('origin')||'';
  const allowed=!origin||origin==='https://ladytin-story-studio.vercel.app'||origin==='http://localhost:4173'||/^https:\/\/ladytin-story-studio-[a-z0-9-]+\.vercel\.app$/i.test(origin)||/^https:\/\/ladytin-story-stu-git-[a-z0-9-]+\.vercel\.app$/i.test(origin);
  return{'Access-Control-Allow-Origin':allowed&&origin?origin:'https://ladytin-story-studio.vercel.app','Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
}
const json=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders(req)});
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}
function randomTicket(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}
function bearer(req:Request){const value=req.headers.get('authorization')||'';return value.toLowerCase().startsWith('bearer ')?value.slice(7).trim():''}
async function attemptKey(req:Request){const forwarded=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';return sha256(`${forwarded}|${req.headers.get('user-agent')||'unknown'}`)}

async function verifyPassword(req:Request,password:string){
  const key=await attemptKey(req);
  const{data:status,error:statusError}=await admin.rpc('app_login_status',{attempt_key:key});
  if(statusError)throw new Error('rate-limit');
  if(status?.locked)return{ok:false,status:429,error:'Too many incorrect attempts. Try again later.',retry_after_seconds:status.retry_after_seconds||900};
  const{data:valid,error:verifyError}=await admin.rpc('verify_app_access_password',{candidate:password});
  if(verifyError)throw new Error('verify');
  if(valid!==true){
    const{data:result,error:recordError}=await admin.rpc('record_app_login_result',{attempt_key:key,succeeded:false});
    if(recordError)throw new Error('attempt');
    if(result?.locked)return{ok:false,status:429,error:'Too many incorrect attempts. Try again later.',retry_after_seconds:result.retry_after_seconds||900};
    return{ok:false,status:401,error:'Incorrect password.'};
  }
  const{error:clearError}=await admin.rpc('record_app_login_result',{attempt_key:key,succeeded:true});
  if(clearError)throw new Error('clear');
  const ticket=randomTicket();
  const{error:ticketError}=await admin.rpc('create_app_access_ticket',{ticket_hash:await sha256(ticket),attempt_key:key,expires_in_seconds:TICKET_SECONDS});
  if(ticketError)throw new Error('ticket');
  return{ok:true,ticket,expires_in:TICKET_SECONDS};
}

async function activateAnonymousSession(req:Request,ticket:string){
  const accessToken=bearer(req);
  if(!accessToken||!ticket)return{ok:false,status:401,error:'Application access could not be verified.'};
  const{data:userData,error:userError}=await admin.auth.getUser(accessToken);
  const user=userData?.user;
  if(userError||!user||user.is_anonymous!==true)return{ok:false,status:401,error:'Application access could not be verified.'};
  const{data:consumed,error:consumeError}=await admin.rpc('consume_app_access_ticket',{ticket_hash:await sha256(ticket)});
  if(consumeError||consumed!==true)return{ok:false,status:401,error:'This access attempt expired. Enter the password again.'};
  const expiresAt=new Date(Date.now()+SESSION_HOURS*60*60*1000).toISOString();
  const{error:updateError}=await admin.auth.admin.updateUserById(user.id,{app_metadata:{...(user.app_metadata||{}),ladytin_shared_access:true,ladytin_shared_access_expires_at:expiresAt}});
  if(updateError)throw new Error('metadata');
  const{error:profileError}=await admin.from('profiles').upsert({id:user.id,display_name:'Collaborator'},{onConflict:'id'});
  if(profileError)throw new Error('profile');
  return{ok:true,expires_at:expiresAt};
}

Deno.serve(async req=>{
  const headers=corsHeaders(req);
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json(req,{error:'POST only.'},405);
  const origin=req.headers.get('origin')||'';
  if(origin&&headers['Access-Control-Allow-Origin']!==origin)return json(req,{error:'Origin not allowed.'},403);
  try{
    const body=await req.json().catch(()=>({}));
    const action=typeof body.action==='string'?body.action:'verify';
    if(action==='verify'){
      const password=typeof body.password==='string'?body.password:'';
      if(!password||password.length>256)return json(req,{error:'Incorrect password.'},401);
      const result=await verifyPassword(req,password);
      return json(req,result,result.ok?200:result.status);
    }
    if(action==='activate'){
      const result=await activateAnonymousSession(req,typeof body.ticket==='string'?body.ticket:'');
      return json(req,result,result.ok?200:result.status);
    }
    return json(req,{error:'Unknown action.'},400);
  }catch{return json(req,{error:'Could not start the application session.'},500)}
});
