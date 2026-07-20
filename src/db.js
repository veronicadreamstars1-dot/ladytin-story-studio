// Pure mapping layer between Supabase rows and the in-app project shape.
// No network calls here — everything is separately testable.
import{makeSlide}from'./parser.js';
import{REFERENCE_MODES,designAnalysis,inferVisualTags}from'./library.js';
import{safeFilename}from'./prompting.js';

export const ROLES=['owner','editor','viewer'];
export const canEdit=role=>role==='owner'||role==='editor';
export const isOwner=role=>role==='owner';

// ---------- auth ----------
export function authReducer(state,action){
  const base=state||{status:'loading',user:null,error:''};
  switch(action?.type){
    case'AUTH_LOADING':return{...base,status:'loading',error:''};
    case'AUTH_SIGNED_IN':return{status:'signed_in',user:action.user||null,error:''};
    case'AUTH_SIGNED_OUT':return{status:'signed_out',user:null,error:''};
    case'AUTH_ERROR':return{...base,status:base.user?'signed_in':'signed_out',error:String(action.error||'Authentication failed.')};
    case'AUTH_LINK_SENT':return{...base,status:'link_sent',error:''};
    default:return base;
  }
}

// ---------- storage paths ----------
export function storagePath(projectId,storySetId,assetId,filename){
  return`projects/${projectId}/story-sets/${storySetId}/assets/${assetId}/${safeFilename(filename,'file')}`;
}

// ---------- assets ----------
export function rowToAsset(row){
  if(!row)return null;
  return{id:row.id,filename:row.original_filename||'',type:row.mime_type||'application/octet-stream',size:Number(row.byte_size)||0,storage_path:row.storage_path||'',asset_type:row.asset_type||'main',story_set_id:row.story_set_id||null,uploaded_by:row.uploaded_by||null,created_at:row.created_at||''};
}

export function rowToLibraryItem(row){
  if(!row)return null;
  const item={id:row.id,library_type:row.library_type,filename:row.original_filename||'',title:row.title||row.original_filename||'',description:row.description||'',type:row.mime_type||'application/octet-stream',size:Number(row.byte_size)||0,source_type:row.source_type||'supabase_storage',source_location:row.source_type||'supabase_storage',storage_path:row.storage_path||'',thumbnail_path:row.thumbnail_path||'',google_drive_file_id:row.google_drive_file_id||'',google_drive_parent_id:row.google_drive_parent_id||'',google_drive_web_view_link:row.google_drive_web_view_link||'',google_drive_modified_at:row.google_drive_modified_at||'',media_category:row.media_category||'',dominant_colours:row.dominant_colours||[],visual_tags:row.visual_tags||{},tags:row.tags||[],collections:row.collections||[],usage_count:Number(row.usage_count)||0,last_used_at:row.last_used_at||'',archived_at:row.archived_at||'',created_at:row.created_at||'',updated_at:row.updated_at||'',revision:Number(row.revision)||1};
  if(!Object.values(item.visual_tags||{}).flat().length)item.visual_tags=inferVisualTags(item);
  item.design_analysis=row.design_analysis||designAnalysis(item,item.visual_tags);
  return item;
}

export function libraryItemToRow(item,{uploadedBy}={}){
  return{id:item.id,library_type:item.library_type,created_by:uploadedBy||item.created_by||null,title:item.title||item.filename||'Untitled item',description:item.description||'',original_filename:item.filename||item.original_filename||'file',mime_type:item.type||item.mime_type||'application/octet-stream',byte_size:item.size||item.byte_size||0,source_type:item.source_type||'supabase_storage',google_drive_file_id:item.google_drive_file_id||null,google_drive_parent_id:item.google_drive_parent_id||null,google_drive_web_view_link:item.google_drive_web_view_link||null,google_drive_modified_at:item.google_drive_modified_at||null,storage_path:item.storage_path||null,thumbnail_path:item.thumbnail_path||null,media_category:item.media_category||'',dominant_colours:item.dominant_colours||[],visual_tags:item.visual_tags||{},search_text:[item.title,item.description,item.filename,item.media_category,(item.tags||[]).join(' ')].filter(Boolean).join(' ')};
}
export function assetToRow(asset,{projectId,storySetId,uploadedBy}){
  return{id:asset.id,project_id:projectId,story_set_id:storySetId||null,uploaded_by:uploadedBy,asset_type:asset.asset_type||'main',original_filename:asset.filename||'file',mime_type:asset.type||'application/octet-stream',storage_path:asset.storage_path,byte_size:asset.size||0};
}

// ---------- slides ----------
export function rowToSlide(row,assetsById={}){
  const base=makeSlide(row.slide_number||1);
  return{...base,id:row.id,storySetId:row.story_set_id,slide_number:row.slide_number||1,
    overlay_text:row.overlay_text||'',copy:row.overlay_text||'',cta:row.cta||'',interaction:row.interaction||'',
    direction:row.direction||'',art:row.direction||'',content_description:row.content_description||'',
    internal_note:row.internal_note||'',no_text_overlay:!!row.no_text_overlay,caption_cc:!!row.caption_cc,
    role:row.role||'Development',
    main:assetsById[row.main_library_item_id]||assetsById[row.main_asset_id]||null,reference:assetsById[row.reference_library_item_id]||assetsById[row.reference_asset_id]||null,
    assetId:row.main_library_item_id||row.main_asset_id||'',referenceId:row.reference_library_item_id||row.reference_asset_id||'',
    mainAssetSource:row.main_library_item_id?'library_media':'manual_upload',
    referenceMode:REFERENCE_MODES.includes(row.reference_mode)?row.reference_mode:'editorial_direction_only',
    referenceMatchScore:row.reference_match_score==null?null:Number(row.reference_match_score),
    referenceMatchReason:row.reference_match_reason||'',referenceLocked:!!row.reference_locked,
    revision:Number(row.revision)||1,updated_at:row.updated_at||'',updated_by:row.updated_by||null};
}
export function slideToRow(slide,storySetId){
  const mainIsLibrary=slide.mainAssetSource==='library_media'||slide.main?.library_type==='media';
  const referenceIsLibrary=slide.referenceMode==='library_reference'||slide.reference?.library_type==='reference';
  return{story_set_id:storySetId||slide.storySetId,slide_number:slide.slide_number||1,role:slide.role||'Development',
    overlay_text:slide.overlay_text??slide.copy??'',cta:slide.cta||'',interaction:slide.interaction||'',
    direction:slide.direction??slide.art??'',content_description:slide.content_description||'',
    internal_note:slide.internal_note||'',no_text_overlay:!!slide.no_text_overlay,caption_cc:!!slide.caption_cc,
    main_asset_id:mainIsLibrary?null:(slide.main?.id||slide.assetId||null),reference_asset_id:referenceIsLibrary?null:(slide.reference?.id||slide.referenceId||null),
    main_library_item_id:mainIsLibrary?(slide.main?.id||slide.assetId||null):null,reference_library_item_id:referenceIsLibrary?(slide.reference?.id||slide.referenceId||null):null,
    reference_mode:REFERENCE_MODES.includes(slide.referenceMode)?slide.referenceMode:'editorial_direction_only',
    reference_match_score:slide.referenceMatchScore??null,
    reference_match_reason:slide.referenceMatchReason||'',reference_locked:!!slide.referenceLocked};
}

// ---------- story sets ----------
export function rowToStorySet(row){
  return{id:row.id,projectId:row.project_id,title:row.title||'Untitled Story Set',
    rawStorySetCopy:row.raw_story_set_copy||'',parseStatus:row.parse_status||'confirmed',
    parseWarnings:Array.isArray(row.parse_warnings)?row.parse_warnings:[],
    overallDirection:row.overall_direction||'',sortOrder:Number(row.sort_order)||0,
    revision:Number(row.revision)||1,updated_at:row.updated_at||'',
    slides:[],mainAssets:[],references:[],logo:null,referencePlan:null};
}
export function storySetToRow(set,projectId){
  return{project_id:projectId||set.projectId,title:set.title||'Untitled Story Set',
    raw_story_set_copy:set.rawStorySetCopy||'',parse_status:set.parseStatus||'confirmed',
    parse_warnings:set.parseWarnings||[],overall_direction:set.overallDirection||'',sort_order:set.sortOrder||0};
}

// ---------- projects ----------
export function rowToProject(row){
  return{id:row.id,title:row.title||'Untitled Project',ownerId:row.owner_id,revision:Number(row.revision)||1,created_at:row.created_at||'',updated_at:row.updated_at||''};
}
export function projectToRow(project){return{title:project.title||'Untitled Project'};}

// ---------- hydration ----------
export function hydrateProject({project,storySets=[],slides=[],assets=[],libraryItems=[]}){
  const appAssets=assets.map(rowToAsset);
  const appLibraryItems=libraryItems.map(rowToLibraryItem);
  const assetsById=Object.fromEntries([...appAssets,...appLibraryItems].map(a=>[a.id,a]));
  const projectMainAssets=appAssets.filter(a=>a.asset_type==='main');
  const projectReferences=appAssets.filter(a=>a.asset_type==='reference');
  const projectLogo=appAssets.find(a=>a.asset_type==='logo')||null;
  const sharedMainAssets=appLibraryItems.filter(a=>a.library_type==='media'&&!a.archived_at);
  const sharedReferences=appLibraryItems.filter(a=>a.library_type==='reference'&&!a.archived_at);

  const sets=storySets.map(rowToStorySet).sort((a,b)=>a.sortOrder-b.sortOrder||a.title.localeCompare(b.title));
  for(const set of sets){
    set.slides=slides.filter(s=>s.story_set_id===set.id).map(r=>rowToSlide(r,assetsById)).sort((a,b)=>a.slide_number-b.slide_number);
    if(!set.slides.length)set.slides=[];

    set.mainAssets=[...sharedMainAssets,...projectMainAssets];
    set.references=[...sharedReferences,...projectReferences];
    set.logo=projectLogo;
  }
  return{project:rowToProject(project),storySets:sets,libraryItems:appLibraryItems};
}

export function serialiseProject(state){
  return{project:projectToRow(state.project),
    storySets:(state.storySets||[]).map((set,i)=>({...storySetToRow(set,state.project?.id),slides:(set.slides||[]).map((s,j)=>slideToRow({...s,slide_number:j+1},set.id))}))};
}

// ---------- realtime ----------
export const revisionKey=(table,id)=>`${table}:${id}`;
export function shouldApplyEvent(seenRevisions,table,row){
  if(!row?.id)return false;
  const rev=Number(row.revision);
  if(!Number.isFinite(rev))return true;
  const seen=seenRevisions?.get?.(revisionKey(table,row.id));
  return!(Number.isFinite(seen)&&seen>=rev);
}
export function applyRealtimeEvent(state,event,assetsById={}){
  const{table,type,row,old}=event||{};
  if(!state||!table||!type)return state;
  const next={...state,storySets:state.storySets.map(s=>({...s}))};
  const findSet=id=>next.storySets.find(s=>s.id===id);
  if(table==='projects'){
    if(type==='UPDATE'&&row?.id===state.project?.id)next.project={...next.project,...rowToProject(row)};
    if(type==='DELETE'&&(old?.id||row?.id)===state.project?.id)return{...next,deleted:true};
    return next;
  }
  if(table==='story_sets'){
    if(type==='INSERT'&&!findSet(row.id)){const set=rowToStorySet(row);set.mainAssets=next.storySets[0]?.mainAssets||[];set.references=next.storySets[0]?.references||[];set.logo=next.storySets[0]?.logo||null;next.storySets.push(set);next.storySets.sort((a,b)=>a.sortOrder-b.sortOrder)}
    if(type==='UPDATE'){const set=findSet(row.id);if(set){const fresh=rowToStorySet(row);Object.assign(set,{title:fresh.title,rawStorySetCopy:fresh.rawStorySetCopy,parseStatus:fresh.parseStatus,parseWarnings:fresh.parseWarnings,overallDirection:fresh.overallDirection,sortOrder:fresh.sortOrder,revision:fresh.revision,updated_at:fresh.updated_at})}}
    if(type==='DELETE')next.storySets=next.storySets.filter(s=>s.id!==(old?.id||row?.id));
    return next;
  }
  if(table==='slides'){
    const set=findSet(row?.story_set_id||old?.story_set_id);
    if(!set)return next;
    set.slides=[...set.slides];
    if(type==='DELETE'){set.slides=set.slides.filter(s=>s.id!==(old?.id||row?.id));return next}
    const mapped=rowToSlide(row,assetsById);
    const idx=set.slides.findIndex(s=>s.id===row.id);
    if(idx===-1)set.slides.push(mapped);else set.slides[idx]=mapped;
    set.slides.sort((a,b)=>a.slide_number-b.slide_number);
    return next;
  }
  if(table==='assets'){
    if(type==='DELETE'){const id=old?.id||row?.id;for(const set of next.storySets){set.mainAssets=set.mainAssets.filter(a=>a.id!==id);set.references=set.references.filter(a=>a.id!==id);if(set.logo?.id===id)set.logo=null;set.slides=set.slides.map(s=>({...s,main:s.main?.id===id?null:s.main,reference:s.reference?.id===id?null:s.reference}))}return next}
    const asset=rowToAsset(row),set=findSet(asset.story_set_id);
    if(!set)return next;
    const list=asset.asset_type==='main'?'mainAssets':asset.asset_type==='reference'?'references':null;
    if(list){const arr=[...set[list]],i=arr.findIndex(a=>a.id===asset.id);if(i===-1)arr.push(asset);else arr[i]={...arr[i],...asset,file:arr[i].file};set[list]=arr}
    else if(asset.asset_type==='logo')set.logo={...asset,file:set.logo?.file};
    // refresh slide links so newly visible metadata is used
    set.slides=set.slides.map(s=>({...s,main:s.main?.id===asset.id?{...asset,file:s.main.file}:s.main,reference:s.reference?.id===asset.id?{...asset,file:s.reference.file}:s.reference}));
    return next;
  }
  if(table==='library_items'){
    const id=old?.id||row?.id;
    if(type==='DELETE'){
      for(const set of next.storySets){
        set.mainAssets=set.mainAssets.filter(a=>a.id!==id);
        set.references=set.references.filter(a=>a.id!==id);
        set.slides=set.slides.map(s=>({...s,main:s.main?.id===id?null:s.main,reference:s.reference?.id===id?null:s.reference}));
      }
      return next;
    }
    const item=rowToLibraryItem(row);
    for(const set of next.storySets){
      const key=item.library_type==='media'?'mainAssets':'references';
      const without=set[key].filter(a=>a.id!==item.id);
      set[key]=item.archived_at?without:[item,...without];
      set.slides=set.slides.map(s=>({...s,main:s.main?.id===item.id?{...item,file:s.main.file}:s.main,reference:s.reference?.id===item.id?{...item,file:s.reference.file}:s.reference}));
    }
    return next;
  }
  return next;
}

// ---------- invites ----------
export function validateInvite(invite,{email,now=new Date()}={}){
  if(!invite)return{ok:false,reason:'This invitation does not exist.'};
  if(invite.accepted_at)return{ok:false,reason:'This invitation has already been used.'};
  if(invite.expires_at&&new Date(invite.expires_at)<now)return{ok:false,reason:'This invitation has expired.'};
  if(email&&invite.email&&invite.email.toLowerCase()!==String(email).toLowerCase())return{ok:false,reason:'This invitation was sent to a different email address.'};
  if(!['editor','viewer'].includes(invite.role))return{ok:false,reason:'This invitation has an invalid role.'};
  return{ok:true,role:invite.role};
}

// ---------- localStorage migration ----------
export const LOCAL_KEY='ladytin-json-studio';
export const MIGRATED_KEY='ladytin-cloud-migrated';
export function migrationPlan(stored){
  if(!stored||typeof stored!=='object')return{ok:false,reason:'No browser-local LadyTin project was found.'};
  const sets=Array.isArray(stored.storySets)?stored.storySets:Array.isArray(stored.slides)?[{title:stored.title||'Untitled Story Set',rawStorySetCopy:stored.copyDraft||'',slides:stored.slides,overallDirection:stored.overallDirection||''}]:[];
  if(!sets.length)return{ok:false,reason:'No browser-local LadyTin project was found.'};
  const plan={ok:true,title:sets[0]?.title?`${sets[0].title} (imported)`:'Imported LadyTin Project',sets:[],assetWarnings:[]};
  sets.forEach((set,i)=>{
    const slides=(Array.isArray(set.slides)?set.slides:[]).map((s,j)=>({slide_number:j+1,role:s.role||(j===0?'Opening':'Development'),overlay_text:s.overlay_text??s.copy??'',cta:s.cta||'',interaction:s.interaction||'',direction:s.direction??s.art??'',content_description:s.content_description||'',internal_note:s.internal_note||'',no_text_overlay:!!s.no_text_overlay,caption_cc:!!s.caption_cc,reference_mode:REFERENCE_MODES.includes(s.referenceMode)?s.referenceMode:'editorial_direction_only',reference_match_score:s.referenceMatchScore??null,reference_match_reason:s.referenceMatchReason||'',reference_locked:!!s.referenceLocked,localMainId:s.main?.id||s.assetId||'',localReferenceId:s.reference?.id||s.referenceId||''}));
    const assets=[...(set.mainAssets||[]).map(a=>({...a,asset_type:'main'})),...(set.references||[]).map(a=>({...a,asset_type:'reference'})),...(set.logo?[{...set.logo,asset_type:'logo'}]:[])];
    for(const a of assets)if(!a.file)plan.assetWarnings.push(`"${a.filename||'unknown file'}" exists only as metadata — its original bytes are no longer available in this browser and must be re-uploaded.`);
    plan.sets.push({title:set.title||`Untitled Story Set ${i+1}`,rawStorySetCopy:set.rawStorySetCopy||'',overallDirection:set.overallDirection||'',sortOrder:i,slides,assets});
  });
  return plan;
}
