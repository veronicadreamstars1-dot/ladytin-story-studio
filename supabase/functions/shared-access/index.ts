import {createClient} from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')??'';
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const SHARED_EMAIL='collaborator@ladytin.invalid';
const SESSION_HOURS=12;
const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
};

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});

async function sha256(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

async function ensureSharedAccessUser(){
  const {data,error}=await admin.auth.admin.generateLink({
    type:'magiclink',
    email:SHARED_EMAIL,
    options:{data:{shared_application:'LadyTin Story Studio'}},
  });
  if(error||!data?.user||!data?.properties?.hashed_token)throw new Error(error?.message||'Could not create the shared application session.');

  const expiresAt=new Date(Date.now()+SESSION_HOURS*60*60*1000).toISOString();
  const {error:updateError}=await admin.auth.admin.updateUserById(data.user.id,{
    app_metadata:{...(data.user.app_metadata||{}),ladytin_shared_access:true,ladytin_shared_access_expires_at:expiresAt},
  });
  if(updateError)throw updateError;

  await admin.from('profiles').upsert({id:data.user.id,display_name:'Collaborator'},{onConflict:'id'});
  const [{data:projects,error:projectsError},{data:members,error:membersError}]=await Promise.all([
    admin.from('projects').select('id'),
    admin.from('project_members').select('project_id').eq('user_id',data.user.id),
  ]);
  if(projectsError)throw projectsError;
  if(membersError)throw membersError;
  const existing=new Set((members||[]).map(row=>row.project_id));
  const missing=(projects||[]).filter(project=>!existing.has(project.id)).map(project=>({project_id:project.id,user_id:data.user.id,role:'editor'}));
  if(missing.length){
    const {error:memberError}=await admin.from('project_members').upsert(missing,{onConflict:'project_id,user_id',ignoreDuplicates:true});
    if(memberError)throw memberError;
  }

  return{token_hash:data.properties.hashed_token,type:'email',expires_at:expiresAt};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'POST only.'},405);

  try{
    const body=await req.json().catch(()=>({}));
    const password=typeof body.password==='string'?body.password:'';
    const clientId=typeof body.client_id==='string'?body.client_id.slice(0,128):'';
    if(!password||password.length>256)return json({error:'Incorrect password.'},401);

    const forwarded=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
    const userAgent=req.headers.get('user-agent')||'unknown';
    const attemptKey=await sha256(`${forwarded}|${userAgent}|${clientId}`);

    const {data:status,error:statusError}=await admin.rpc('app_login_status',{attempt_key:attemptKey});
    if(statusError)throw statusError;
    if(status?.locked)return json({error:'Too many incorrect attempts. Try again later.',retry_after_seconds:status.retry_after_seconds||900},429);

    const {data:valid,error:verifyError}=await admin.rpc('verify_app_access_password',{candidate:password});
    if(verifyError)throw verifyError;
    if(valid!==true){
      const {data:result,error:recordError}=await admin.rpc('record_app_login_result',{attempt_key:attemptKey,succeeded:false});
      if(recordError)throw recordError;
      if(result?.locked)return json({error:'Too many incorrect attempts. Try again later.',retry_after_seconds:result.retry_after_seconds||900},429);
      return json({error:'Incorrect password.'},401);
    }

    const {error:clearError}=await admin.rpc('record_app_login_result',{attempt_key:attemptKey,succeeded:true});
    if(clearError)throw clearError;
    return json(await ensureSharedAccessUser());
  }catch(error){
    return json({error:error instanceof Error?error.message:'Could not start the application session.'},500);
  }
});
