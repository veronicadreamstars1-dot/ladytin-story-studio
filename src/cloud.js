// Network layer: Supabase auth, cloud persistence, storage and invitations.
// All mapping is delegated to db.js so it stays independently testable.
import{supabase}from'./supabase.js';
import{assetToRow,pinToRow,revisionKey,rowToAsset,rowToPin,rowToProject,rowToSlide,rowToStorySet,slideToRow,storySetToRow,hydrateProject,migrationPlan,LOCAL_KEY,MIGRATED_KEY,storagePath}from'./db.js';

const BUCKET='project-files';
export const seenRevisions=new Map();
const record=(table,row)=>{if(row?.id&&Number.isFinite(Number(row.revision)))seenRevisions.set(revisionKey(table,row.id),Number(row.revision))};
const fail=(error,fallback)=>{throw new Error(error?.message||fallback)};

// ---------- auth ----------
export async function sendMagicLink(email){
  const{error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  if(error)fail(error,'Could not send the sign-in link.');
}
export async function signOut(){await supabase.auth.signOut()}
export async function ensureProfile(user){
  if(!user)return;
  await supabase.from('profiles').upsert({id:user.id,display_name:user.user_metadata?.display_name||user.email||''},{onConflict:'id'});
}

// ---------- projects ----------
export async function listProjects(){
  const{data,error}=await supabase.from('projects').select('*').order('updated_at',{ascending:false});
  if(error)fail(error,'Could not load projects.');
  return(data||[]).map(rowToProject);
}
export async function myRole(projectId,userId){
  const{data}=await supabase.from('project_members').select('role').eq('project_id',projectId).eq('user_id',userId).maybeSingle();
  return data?.role||null;
}
export async function createProject(title,user){
  // No RETURNING here: the owner-membership trigger fires after RETURNING is
  // evaluated, so the read-back must be a separate request.
  const id=crypto.randomUUID();
  const{error}=await supabase.from('projects').insert({id,title:title||'Untitled Project',owner_id:user.id});
  if(error)fail(error,'Could not create the project.');
  const{data,error:readError}=await supabase.from('projects').select('*').eq('id',id).single();
  if(readError)fail(readError,'Could not load the created project.');
  record('projects',data);
  if(user.email)await supabase.from('project_members').update({invited_email:user.email}).eq('project_id',data.id).eq('user_id',user.id);
  return rowToProject(data);
}
export async function renameProject(projectId,title){
  const{data,error}=await supabase.from('projects').update({title}).eq('id',projectId).select().single();
  if(error)fail(error,'Could not rename the project.');
  record('projects',data);return rowToProject(data);
}
export async function deleteProject(projectId){
  const{error}=await supabase.from('projects').delete().eq('id',projectId);
  if(error)fail(error,'Could not delete the project.');
}
export async function loadProject(projectId){
  const[p,sets,assets,pins,conn]=await Promise.all([
    supabase.from('projects').select('*').eq('id',projectId).single(),
    supabase.from('story_sets').select('*').eq('project_id',projectId).order('sort_order'),
    supabase.from('assets').select('*').eq('project_id',projectId),
    supabase.from('pinterest_pins').select('*').eq('project_id',projectId),
    supabase.from('pinterest_connections').select('project_id,board_url,last_synced_at').eq('project_id',projectId).maybeSingle(),
  ]);
  if(p.error)fail(p.error,'Could not open this project.');
  const setIds=(sets.data||[]).map(s=>s.id);
  let slides=[];
  if(setIds.length){
    const r=await supabase.from('slides').select('*').in('story_set_id',setIds).order('slide_number');
    if(r.error)fail(r.error,'Could not load slides.');
    slides=r.data||[];
  }
  [p.data,...(sets.data||[]),...slides].forEach(row=>record(row.owner_id!==undefined?'projects':row.project_id!==undefined?'story_sets':'slides',row));
  return hydrateProject({project:p.data,storySets:sets.data||[],slides,assets:assets.data||[],pins:pins.data||[],connection:conn.data||null});
}

// ---------- story sets ----------
export async function insertStorySet(projectId,set){
  const{data,error}=await supabase.from('story_sets').insert(storySetToRow(set,projectId)).select().single();
  if(error)fail(error,'Could not save the story set.');
  record('story_sets',data);return rowToStorySet(data);
}
export async function updateStorySetGuarded(setId,expectedRevision,patch){
  const{data,error}=await supabase.from('story_sets').update(patch).eq('id',setId).eq('revision',expectedRevision).select();
  if(error)fail(error,'Could not save the story set.');
  if(!data?.length){
    const{data:remote}=await supabase.from('story_sets').select('*').eq('id',setId).maybeSingle();
    return{conflict:true,remote:remote?rowToStorySet(remote):null};
  }
  record('story_sets',data[0]);return{conflict:false,row:rowToStorySet(data[0])};
}
export async function deleteStorySet(setId){
  const{error}=await supabase.from('story_sets').delete().eq('id',setId);
  if(error)fail(error,'Could not delete the story set.');
}

// ---------- slides ----------
export async function insertSlide(storySetId,slide){
  const{data,error}=await supabase.from('slides').insert(slideToRow(slide,storySetId)).select().single();
  if(error)fail(error,'Could not create the slide.');
  record('slides',data);return data;
}
export async function insertSlides(storySetId,slides){
  if(!slides.length)return[];
  const{data,error}=await supabase.from('slides').insert(slides.map(s=>slideToRow(s,storySetId))).select();
  if(error)fail(error,'Could not create slides.');
  (data||[]).forEach(r=>record('slides',r));return data||[];
}
export async function updateSlideGuarded(slideId,expectedRevision,patch){
  const{data,error}=await supabase.from('slides').update(patch).eq('id',slideId).eq('revision',expectedRevision).select();
  if(error)fail(error,'Could not save the slide.');
  if(!data?.length){
    const{data:remote}=await supabase.from('slides').select('*').eq('id',slideId).maybeSingle();
    return{conflict:true,remote:remote||null};
  }
  record('slides',data[0]);return{conflict:false,row:data[0]};
}
export async function overwriteSlide(slideId,patch){
  const{data:remote}=await supabase.from('slides').select('revision').eq('id',slideId).maybeSingle();
  if(!remote)throw new Error('This slide no longer exists.');
  return updateSlideGuarded(slideId,remote.revision,patch);
}
export async function deleteSlide(slideId){
  const{error}=await supabase.from('slides').delete().eq('id',slideId);
  if(error)fail(error,'Could not delete the slide.');
}

// ---------- assets & storage ----------
export async function uploadAsset({projectId,storySetId,file,assetType,userId}){
  const assetId=crypto.randomUUID();
  const path=storagePath(projectId,storySetId,assetId,file.name);
  const{error:upErr}=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(upErr)fail(upErr,`Could not upload "${file.name}".`);
  const row=assetToRow({id:assetId,filename:file.name,type:file.type||'application/octet-stream',size:file.size||0,storage_path:path,asset_type:assetType},{projectId,storySetId,uploadedBy:userId});
  const{data,error}=await supabase.from('assets').insert(row).select().single();
  if(error){await supabase.storage.from(BUCKET).remove([path]);fail(error,`Could not register "${file.name}".`)}
  return{...rowToAsset(data),file};
}
export async function deleteAsset(asset){
  if(asset.storage_path)await supabase.storage.from(BUCKET).remove([asset.storage_path]);
  const{error}=await supabase.from('assets').delete().eq('id',asset.id);
  if(error)fail(error,`Could not remove "${asset.filename}".`);
}
export async function signedAssetUrl(asset,seconds=3600){
  const{data,error}=await supabase.storage.from(BUCKET).createSignedUrl(asset.storage_path,seconds);
  if(error)fail(error,'Could not create a preview link.');
  return data.signedUrl;
}
// Shared binary resolver used by every ZIP path: local File/Blob first, then private Storage.
export async function resolveAssetBinary(asset){
  if(!asset)throw new Error('No asset was provided.');
  if(asset.file&&typeof asset.file.arrayBuffer==='function'){
    const bytes=await asset.file.arrayBuffer();
    if(bytes.byteLength>0)return bytes;
  }
  if(!asset.storage_path)throw new Error(`"${asset.filename||'unknown file'}" has no cloud copy and its original bytes are not available in this session.`);
  const{data,error}=await supabase.storage.from(BUCKET).download(asset.storage_path);
  if(error||!data)throw new Error(`Could not download "${asset.filename||'unknown file'}" from project storage${error?.message?`: ${error.message}`:'.'}`);
  const bytes=await data.arrayBuffer();
  if(!bytes.byteLength)throw new Error(`Downloaded file "${asset.filename||'unknown file'}" is empty.`);
  return bytes;
}

// ---------- members & invites ----------
export async function listMembers(projectId){
  const{data,error}=await supabase.from('project_members').select('*').eq('project_id',projectId).order('created_at');
  if(error)fail(error,'Could not load project members.');
  return data||[];
}
export async function changeMemberRole(projectId,userId,role){
  const{error}=await supabase.from('project_members').update({role}).eq('project_id',projectId).eq('user_id',userId);
  if(error)fail(error,'Could not change this member’s role.');
}
export async function removeMember(projectId,userId){
  const{error}=await supabase.from('project_members').delete().eq('project_id',projectId).eq('user_id',userId);
  if(error)fail(error,'Could not remove this member.');
}
export async function createInvite(projectId,email,role,userId){
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  const expires=new Date(Date.now()+7*24*3600*1000).toISOString();
  const{data,error}=await supabase.from('project_invites').insert({project_id:projectId,email:email.trim().toLowerCase(),role,token,invited_by:userId,expires_at:expires}).select().single();
  if(error)fail(error,'Could not create the invitation.');
  return{...data,url:`${location.origin}/?invite=${token}`};
}
export async function listInvites(projectId){
  const{data}=await supabase.from('project_invites').select('*').eq('project_id',projectId).is('accepted_at',null).order('created_at',{ascending:false});
  return data||[];
}
export async function acceptInvite(token){
  const{data,error}=await supabase.rpc('accept_project_invite',{invite_token:token});
  if(error)fail(error,'This invitation could not be accepted.');
  return data;
}

// ---------- pinterest ----------
export async function upsertPins(projectId,pins){
  if(!pins.length)return[];
  const{data,error}=await supabase.from('pinterest_pins').upsert(pins.map(p=>pinToRow(p,projectId)),{onConflict:'project_id,pinterest_pin_id'}).select();
  if(error)fail(error,'Could not store the imported Pins.');
  return(data||[]).map(r=>rowToPin(r));
}
export async function pinterestAction(action,payload={}){
  const{data,error}=await supabase.functions.invoke('pinterest',{body:{action,...payload}});
  if(error)throw new Error(data?.error||error.message||'Pinterest request failed.');
  if(data?.error)throw new Error(data.error);
  return data;
}

// ---------- localStorage migration ----------
export function readLocalProject(){
  try{return JSON.parse(localStorage.getItem(LOCAL_KEY)||'null')}catch{return null}
}
export const migrationComplete=()=>localStorage.getItem(MIGRATED_KEY)==='true';
const PARTIAL_KEY='ladytin-cloud-migration-partial';
export async function migrateLocalProject(user,localState,inMemorySets){
  if(migrationComplete())return{ok:false,reason:'This browser’s project has already been imported.'};
  const plan=migrationPlan(localState);
  if(!plan.ok)return plan;
  // A retried migration first removes the incomplete project so no duplicates are created.
  const partial=localStorage.getItem(PARTIAL_KEY);
  if(partial){try{await deleteProject(partial)}catch{}localStorage.removeItem(PARTIAL_KEY)}
  const project=await createProject(plan.title,user);
  localStorage.setItem(PARTIAL_KEY,project.id);
  const warnings=[...plan.assetWarnings];
  try{
    for(const setPlan of plan.sets){
      const set=await insertStorySet(project.id,{title:setPlan.title,rawStorySetCopy:setPlan.rawStorySetCopy,overallDirection:setPlan.overallDirection,parseStatus:'confirmed',parseWarnings:[],sortOrder:setPlan.sortOrder});
      // Upload binaries still present in this browser session (in-memory Files).
      const live=inMemorySets?.[setPlan.sortOrder];
      const idMap={};
      for(const meta of setPlan.assets){
        const liveAsset=[...(live?.mainAssets||[]),...(live?.references||[]),...(live?.logo?[live.logo]:[])].find(a=>a.id===meta.id&&a.file);
        if(liveAsset?.file){
          const uploaded=await uploadAsset({projectId:project.id,storySetId:set.id,file:new File([await liveAsset.file.arrayBuffer()],meta.filename||'file',{type:meta.type||'application/octet-stream'}),assetType:meta.asset_type,userId:user.id});
          idMap[meta.id]=uploaded.id;
        }
      }
      await insertSlides(set.id,setPlan.slides.map(s=>({...s,slide_number:s.slide_number,overlay_text:s.overlay_text,copy:s.overlay_text,cta:s.cta,interaction:s.interaction,direction:s.direction,art:s.direction,content_description:s.content_description,internal_note:s.internal_note,no_text_overlay:s.no_text_overlay,caption_cc:s.caption_cc,role:s.role,referenceMode:s.reference_mode,pinterestPinId:s.pinterest_pin_id||'',pinterestMatchScore:s.pinterest_match_score,pinterestMatchReason:s.pinterest_match_reason,referenceLocked:s.reference_locked,assetId:idMap[s.localMainId]||null,referenceId:idMap[s.localReferenceId]||null,main:null,reference:null})));
      const livePins=live?.pinterestPins||[];
      if(livePins.length)await upsertPins(project.id,livePins);
    }
  }catch(error){
    return{ok:false,reason:`Migration stopped before completing: ${error.message}. Nothing was marked as migrated — retrying is safe.`,projectId:project.id};
  }
  localStorage.removeItem(PARTIAL_KEY);
  localStorage.setItem(MIGRATED_KEY,'true');
  return{ok:true,projectId:project.id,warnings};
}
