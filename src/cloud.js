// Network layer for the password-gated shared editor: cloud persistence, Storage and Pinterest.
// All mapping is delegated to db.js so it stays independently testable.
import{supabase}from'./supabase.js';
import{assetToRow,pinToRow,revisionKey,rowToAsset,rowToPin,rowToProject,rowToSlide,rowToStorySet,slideToRow,storySetToRow,hydrateProject,migrationPlan,LOCAL_KEY,MIGRATED_KEY,storagePath}from'./db.js';

const BUCKET='project-files';
export const seenRevisions=new Map();
const record=(table,row)=>{if(row?.id&&Number.isFinite(Number(row.revision)))seenRevisions.set(revisionKey(table,row.id),Number(row.revision))};
const fail=(error,fallback)=>{throw new Error(error?.message||fallback)};

export async function signOut(){await supabase.auth.signOut()}

// ---------- projects ----------
export async function listProjects(){
  const{data,error}=await supabase.from('projects').select('*').order('updated_at',{ascending:false});
  if(error)fail(error,'Could not load projects.');
  return(data||[]).map(rowToProject);
}
export async function createProject(title,user){
  const id=crypto.randomUUID();
  const{error}=await supabase.from('projects').insert({id,title:title||'Untitled Project',owner_id:user.id});
  if(error)fail(error,'Could not create the project.');
  const{data,error:readError}=await supabase.from('projects').select('*').eq('id',id).single();
  if(readError)fail(readError,'Could not load the created project.');
  record('projects',data);
  return rowToProject(data);
}
export async function renameProject(projectId,title){
  const{data,error}=await supabase.from('projects').update({title}).eq('id',projectId).select().single();
  if(error)fail(error,'Could not rename the project.');
  record('projects',data);
  return rowToProject(data);
}
export async function deleteProject(projectId){
  const{error}=await supabase.from('projects').delete().eq('id',projectId);
  if(error)fail(error,'Could not delete the project.');
}
export async function loadProject(projectId){
  const[p,sets,assets,pins]=await Promise.all([
    supabase.from('projects').select('*').eq('id',projectId).single(),
    supabase.from('story_sets').select('*').eq('project_id',projectId).order('sort_order'),
    supabase.from('assets').select('*').eq('project_id',projectId),
    supabase.from('pinterest_pins').select('*').eq('project_id',projectId),
  ]);
  if(p.error)fail(p.error,'Could not open this project.');
  if(sets.error)fail(sets.error,'Could not load story sets.');
  if(assets.error)fail(assets.error,'Could not load project assets.');
  if(pins.error)fail(pins.error,'Could not load Pinterest references.');
  const setIds=(sets.data||[]).map(set=>set.id);
  let slides=[];
  if(setIds.length){
    const result=await supabase.from('slides').select('*').in('story_set_id',setIds).order('slide_number');
    if(result.error)fail(result.error,'Could not load slides.');
    slides=result.data||[];
  }
  [p.data,...(sets.data||[]),...slides].forEach(row=>record(row.owner_id!==undefined?'projects':row.project_id!==undefined?'story_sets':'slides',row));
  return hydrateProject({project:p.data,storySets:sets.data||[],slides,assets:assets.data||[],pins:pins.data||[],connection:null});
}

// ---------- story sets ----------
export async function insertStorySet(projectId,set){
  const{data,error}=await supabase.from('story_sets').insert(storySetToRow(set,projectId)).select().single();
  if(error)fail(error,'Could not save the story set.');
  record('story_sets',data);
  return rowToStorySet(data);
}
export async function updateStorySetGuarded(setId,expectedRevision,patch){
  const{data,error}=await supabase.from('story_sets').update(patch).eq('id',setId).eq('revision',expectedRevision).select();
  if(error)fail(error,'Could not save the story set.');
  if(!data?.length){
    const{data:remote}=await supabase.from('story_sets').select('*').eq('id',setId).maybeSingle();
    return{conflict:true,remote:remote?rowToStorySet(remote):null};
  }
  record('story_sets',data[0]);
  return{conflict:false,row:rowToStorySet(data[0])};
}
export async function deleteStorySet(setId){
  const{error}=await supabase.from('story_sets').delete().eq('id',setId);
  if(error)fail(error,'Could not delete the story set.');
}

// ---------- slides ----------
export async function insertSlide(storySetId,slide){
  const{data,error}=await supabase.from('slides').insert(slideToRow(slide,storySetId)).select().single();
  if(error)fail(error,'Could not create the slide.');
  record('slides',data);
  return data;
}
export async function insertSlides(storySetId,slides){
  if(!slides.length)return[];
  const{data,error}=await supabase.from('slides').insert(slides.map(slide=>slideToRow(slide,storySetId))).select();
  if(error)fail(error,'Could not create slides.');
  (data||[]).forEach(row=>record('slides',row));
  return data||[];
}
export async function updateSlideGuarded(slideId,expectedRevision,patch){
  const{data,error}=await supabase.from('slides').update(patch).eq('id',slideId).eq('revision',expectedRevision).select();
  if(error)fail(error,'Could not save the slide.');
  if(!data?.length){
    const{data:remote}=await supabase.from('slides').select('*').eq('id',slideId).maybeSingle();
    return{conflict:true,remote:remote||null};
  }
  record('slides',data[0]);
  return{conflict:false,row:data[0]};
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
  const{error:uploadError}=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(uploadError)fail(uploadError,`Could not upload "${file.name}".`);
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

// ---------- Pinterest ----------
export async function upsertPins(projectId,pins){
  if(!pins.length)return[];
  const{data,error}=await supabase.from('pinterest_pins').upsert(pins.map(pin=>pinToRow(pin,projectId)),{onConflict:'project_id,pinterest_pin_id'}).select();
  if(error)fail(error,'Could not store the imported Pins.');
  return(data||[]).map(row=>rowToPin(row));
}
export async function pinterestAction(action,payload={}){
  const{data,error}=await supabase.functions.invoke('pinterest',{body:{action,...payload}});
  if(error)throw new Error(data?.error||error.message||'Pinterest request failed.');
  if(data?.error)throw new Error(data.error);
  return data;
}

// ---------- browser project migration ----------
export function readLocalProject(){
  try{return JSON.parse(localStorage.getItem(LOCAL_KEY)||'null')}catch{return null}
}
export const migrationComplete=()=>localStorage.getItem(MIGRATED_KEY)==='true';
const PARTIAL_KEY='ladytin-cloud-migration-partial';
export async function migrateLocalProject(user,localState,inMemorySets){
  if(migrationComplete())return{ok:false,reason:'This browser’s project has already been imported.'};
  const plan=migrationPlan(localState);
  if(!plan.ok)return plan;
  const partial=localStorage.getItem(PARTIAL_KEY);
  if(partial){try{await deleteProject(partial)}catch{}localStorage.removeItem(PARTIAL_KEY)}
  const project=await createProject(plan.title,user);
  localStorage.setItem(PARTIAL_KEY,project.id);
  const warnings=[...plan.assetWarnings];
  try{
    for(const setPlan of plan.sets){
      const set=await insertStorySet(project.id,{title:setPlan.title,rawStorySetCopy:setPlan.rawStorySetCopy,overallDirection:setPlan.overallDirection,parseStatus:'confirmed',parseWarnings:[],sortOrder:setPlan.sortOrder});
      const live=inMemorySets?.[setPlan.sortOrder];
      const idMap={};
      for(const meta of setPlan.assets){
        const liveAsset=[...(live?.mainAssets||[]),...(live?.references||[]),...(live?.logo?[live.logo]:[])].find(asset=>asset.id===meta.id&&asset.file);
        if(liveAsset?.file){
          const uploaded=await uploadAsset({projectId:project.id,storySetId:set.id,file:new File([await liveAsset.file.arrayBuffer()],meta.filename||'file',{type:meta.type||'application/octet-stream'}),assetType:meta.asset_type,userId:user.id});
          idMap[meta.id]=uploaded.id;
        }
      }
      await insertSlides(set.id,setPlan.slides.map(slide=>({...slide,slide_number:slide.slide_number,overlay_text:slide.overlay_text,copy:slide.overlay_text,cta:slide.cta,interaction:slide.interaction,direction:slide.direction,art:slide.direction,content_description:slide.content_description,internal_note:slide.internal_note,no_text_overlay:slide.no_text_overlay,caption_cc:slide.caption_cc,role:slide.role,referenceMode:slide.reference_mode,pinterestPinId:slide.pinterest_pin_id||'',pinterestMatchScore:slide.pinterest_match_score,pinterestMatchReason:slide.pinterest_match_reason,referenceLocked:slide.reference_locked,assetId:idMap[slide.localMainId]||null,referenceId:idMap[slide.localReferenceId]||null,main:null,reference:null})));
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
