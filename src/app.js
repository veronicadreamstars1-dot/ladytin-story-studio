import {bulkPrompt,makeSlideZip,makeZip,n,parseJson,pretty,readiness,slidePrompt,slug} from './prompting.js';
import {makeSlide,parseStorySets} from './parser.js';
import {REFERENCE_MODES,applyReferencePlan,buildReferencePlan,recommendReferencesForSlide,resolveReferenceStrategy} from './library.js';
import {isConfigured,missingConfig,supabase} from './supabase.js';
import {applyRealtimeEvent,rowToSlide,slideToRow,storySetToRow} from './db.js';
import * as cloud from './cloud.js';
import {joinPresence,subscribeToProject,unsubscribeAll,updatePresence} from './realtime.js';

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const steps=['Copy','Review Story','Assets & References','Generate'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const defaultSet=()=>({
  id:`set-${crypto.randomUUID()}`,
  title:'Untitled Story Set',
  rawStorySetCopy:'',
  parseStatus:'confirmed',
  parseWarnings:[],
  overallDirection:'',
  slides:[makeSlide(1)],
  mainAssets:[],
  references:[],
  logo:null,
  referencePlan:null,
});
const stored=cloud.readLocalProject()||{};
const prefs=JSON.parse(localStorage.getItem('ladytin-ui-prefs')||'{}');

function normaliseSlide(slide,index,set){
  return {
    ...makeSlide(index+1),
    ...slide,
    slide_number:index+1,
    overlay_text:slide.overlay_text??slide.copy??'',
    copy:slide.overlay_text??slide.copy??'',
    direction:slide.direction??slide.art??'',
    art:slide.direction??slide.art??'',
    main:slide.main||null,
    reference:slide.reference||null,
    referenceMode:REFERENCE_MODES.includes(slide.referenceMode)
      ? slide.referenceMode
      : slide.reference
        ? slide.reference.library_type==='reference'?'library_reference':'manual_upload'
        : 'editorial_direction_only',
    mainAssetSource:slide.mainAssetSource||(slide.main?.library_type==='media'?'library_media':'manual_upload'),
    referenceMatchScore:slide.referenceMatchScore??null,
    referenceMatchReason:slide.referenceMatchReason||'',
    referenceLocked:!!slide.referenceLocked,
  };
}

function normaliseSet(input){
  const base={
    ...defaultSet(),
    ...input,
    bp:undefined,
    defaultRef:undefined,
    mainAssets:input.mainAssets||[],
    references:input.references||[],
    overallDirection:input.overallDirection||'',
  };
  base.slides=(input.slides?.length?input.slides:[makeSlide(1)]).map((slide,index)=>normaliseSlide(slide,index,base));
  return base;
}

const state={
  storySets:[defaultSet()],
  activeSet:0,
  activeStep:Math.min(prefs.activeStep||0,3),
  rawInput:'',
  parseReview:null,
  selectedSlide:prefs.selectedSlide||0,
  librarySearch:'',
  libraryFilter:'',
  libraryView:'grid',
};
const cloudState={
  view:isConfigured()?'loading':'config',
  auth:{user:null},
  projects:[],
  project:null,
  role:'editor',
  presence:[],
  saveState:'saved',
  conflict:null,
  migrationResult:null,
};
const snapshot=new Map();
let toastTimer;
let saveTimer=null;
let flushing=false;
let flushQueued=false;
let presenceEditTimer=null;

const current=()=>state.storySets[state.activeSet];
const editable=()=>cloudState.view==='studio';
const isUuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const badge=(text,tone='')=>`<span class="badge ${tone}">${esc(text)}</span>`;
const btn=(text,id,kind='secondary',attrs='')=>`<button class="btn ${kind}" id="${id}" ${attrs}>${text}</button>`;
const field=(label,control,help='')=>`<label class="field"><span>${label}</span>${control}${help?`<small>${help}</small>`:''}</label>`;
const fullJson=()=>pretty(bulkPrompt(current().slides,current(),current().logo));
const rows=()=>readiness(current().slides,current(),current().logo);

function snapEntity(kind,id,row,revision,setId){snapshot.set(id,{kind,json:JSON.stringify(row),revision,setId})}
function rebuildSnapshot(){
  snapshot.clear();
  for(const set of state.storySets){
    if(!set.cloudId)continue;
    snapEntity('story_set',set.id,storySetToRow(set,cloudState.project.id),set.revision||1);
    for(const slide of set.slides){
      if(slide.storySetId||isUuid(slide.id))snapEntity('slide',slide.id,slideToRow({...slide},set.id),slide.revision||1,set.id);
    }
  }
}
function savePrefs(){localStorage.setItem('ladytin-ui-prefs',JSON.stringify({activeStep:state.activeStep,selectedSlide:state.selectedSlide,activeSet:state.activeSet}))}
function renderSaveState(){
  const element=$('#saveState');
  if(!element)return;
  element.textContent=cloudState.saveState==='saving'?'Saving':cloudState.saveState==='error'?'Error':'Saved';
  element.className=`save-state ${cloudState.saveState==='error'?'error':cloudState.saveState==='saving'?'saving':''}`;
}
function save(immediate=false){
  savePrefs();
  if(!editable())return;
  clearTimeout(saveTimer);
  if(immediate)return void flushSync();
  cloudState.saveState='saving';
  renderSaveState();
  saveTimer=setTimeout(flushSync,700);
}
async function flushSync(){
  if(!editable())return;
  if(flushing){flushQueued=true;return}
  flushing=true;
  cloudState.saveState='saving';
  renderSaveState();
  try{
    const projectId=cloudState.project.id;
    const liveSetIds=new Set();
    const liveSlideIds=new Set();
    for(const set of state.storySets){
      if(!isUuid(set.id)){
        const created=await cloud.insertStorySet(projectId,{...set,sortOrder:state.storySets.indexOf(set)});
        set.id=created.id;
        set.cloudId=created.id;
        set.revision=created.revision;
        set.slides.forEach(slide=>{slide.storySetId=created.id});
        snapEntity('story_set',set.id,storySetToRow(set,projectId),set.revision);
      }
      set.cloudId=set.id;
      liveSetIds.add(set.id);
      const setRow=storySetToRow({...set,sortOrder:state.storySets.indexOf(set)},projectId);
      const setSnapshot=snapshot.get(set.id);
      if(!setSnapshot)snapEntity('story_set',set.id,setRow,set.revision||1);
      else if(setSnapshot.json!==JSON.stringify(setRow)){
        const result=await cloud.updateStorySetGuarded(set.id,set.revision||1,setRow);
        if(result.conflict){cloudState.conflict={kind:'story_set',id:set.id,remote:result.remote};continue}
        set.revision=result.row.revision;
        snapEntity('story_set',set.id,setRow,set.revision);
      }
      for(const[index,slide] of set.slides.entries()){
        slide.slide_number=index+1;
        if(!isUuid(slide.id)){
          const row=await cloud.insertSlide(set.id,{...slide});
          slide.id=row.id;
          slide.storySetId=set.id;
          slide.revision=row.revision;
          snapEntity('slide',slide.id,slideToRow({...slide},set.id),slide.revision,set.id);
        }
        liveSlideIds.add(slide.id);
        const slideRow=slideToRow({...slide},set.id);
        const slideSnapshot=snapshot.get(slide.id);
        if(!slideSnapshot)snapEntity('slide',slide.id,slideRow,slide.revision||1,set.id);
        else if(slideSnapshot.json!==JSON.stringify(slideRow)){
          const result=await cloud.updateSlideGuarded(slide.id,slide.revision||1,slideRow);
          if(result.conflict){
            cloudState.conflict={kind:'slide',id:slide.id,setId:set.id,remote:result.remote,localRow:slideRow};
            render();
            continue;
          }
          slide.revision=result.row.revision;
          slide.updated_at=result.row.updated_at;
          snapEntity('slide',slide.id,slideRow,slide.revision,set.id);
        }
      }
    }
    for(const[id,entry] of [...snapshot.entries()]){
      if(entry.kind==='story_set'&&!liveSetIds.has(id)){await cloud.deleteStorySet(id);snapshot.delete(id)}
      if(entry.kind==='slide'&&!liveSlideIds.has(id)&&liveSetIds.has(entry.setId)){await cloud.deleteSlide(id);snapshot.delete(id)}
      if(entry.kind==='slide'&&!liveSetIds.has(entry.setId))snapshot.delete(id);
    }
    cloudState.saveState=cloudState.conflict?'error':'saved';
  }catch(error){
    console.error('Autosave failed:',error);
    cloudState.saveState='error';
    toast(`Could not save: ${error.message}`,'bad');
  }
  flushing=false;
  renderSaveState();
  if(flushQueued){flushQueued=false;void flushSync()}
}
async function flushNow(){clearTimeout(saveTimer);if(editable())await flushSync()}

function toast(text,tone='ok'){
  const element=$('#toast');
  if(!element)return;
  element.textContent=text;
  element.className=`toast show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>element.className='toast',3500);
}
async function cp(text,message='JSON copied.'){await navigator.clipboard?.writeText(text);toast(message)}
function dl(name,data,type='application/json'){
  const anchor=document.createElement('a');
  anchor.href=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));
  anchor.download=name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(anchor.href),5000);
}
function preview(asset){
  if(!asset)return'<div class="file-tile empty">No file</div>';
  const type=asset.type||'application/octet-stream',src=asset.previewUrl||(asset.type?.startsWith('image/')&&asset.file?URL.createObjectURL(asset.file):'');
  if(type.startsWith('image/')&&src)return`<img class="thumb ${type==='image/svg+xml'?'contain':''}" src="${esc(src)}" alt="${esc(asset.title||asset.filename||'Library preview')}" loading="lazy">`;
  if(type.startsWith('image/'))return'<div class="file-tile image-placeholder">IMG</div>';
  if(type.startsWith('video/')&&asset.previewUrl)return`<video class="thumb contain" src="${esc(asset.previewUrl)}" muted playsinline preload="metadata"></video>`;
  if(type.startsWith('video/'))return'<div class="file-tile video-placeholder">VIDEO</div>';
  if(type==='application/pdf')return'<div class="file-tile pdf-placeholder">PDF</div>';
  return'<div class="file-tile file-placeholder">FILE</div>';
}
function setStep(index){state.activeStep=Math.max(0,Math.min(3,index));save();void updatePresence({activity:'viewing',context:steps[state.activeStep]});render();scrollTo({top:0,behavior:'smooth'})}
function progress(){
  const set=current();
  const status=rows();
  return [
    !!state.rawInput.trim()||set.slides.some(slide=>(slide.copy||'').trim()),
    set.parseStatus==='confirmed'&&set.slides.length>0,
    set.slides.every(slide=>slide.main&&readiness([slide],set,set.logo)[0].reference),
    status.every(row=>row.ready),
  ];
}
function presenceStrip(){
  const others=cloudState.presence.filter(entry=>entry.user_id!==cloudState.auth.user?.id);
  if(!others.length)return'';
  return`<div class="presence-strip">${others.slice(0,4).map(entry=>`<span class="presence-chip">${esc(entry.name)} is ${esc(entry.activity||'viewing')} ${esc(entry.context||'')}</span>`).join('')}</div>`;
}
function conflictBar(){
  const conflict=cloudState.conflict;
  if(!conflict)return'';
  return`<div class="conflict-bar"><span>This slide was updated by another collaborator. Reload the latest version or overwrite it.</span>${btn('Reload latest','conflictReload','secondary')}${btn('Overwrite','conflictOverwrite','danger')}</div>`;
}
function shell(content,title,description){
  const done=progress();
  const set=current();
  return`<div class="app-shell"><header class="topbar"><div><b>LadyTin Story Studio</b><span class="project-status">${esc(set.title)}</span></div><div class="top-actions">${presenceStrip()}<span id="saveState" class="save-state">Saved</span>${btn('Projects','backProjects','tertiary')}${btn('Reference Library','navReferenceLibrary','tertiary')}${btn('Media Library','navMediaLibrary','tertiary')}<select id="setPicker" aria-label="Active story set">${state.storySets.map((storySet,index)=>`<option value="${index}" ${index===state.activeSet?'selected':''}>${String(index+1).padStart(2,'0')} · ${esc(storySet.title)}</option>`).join('')}</select>${btn('Save Project','saveProject')}${state.activeStep<3?btn('Continue','continue','primary'):''}${btn('Sign Out','signOut','tertiary')}</div></header><nav class="stepper" aria-label="Workflow">${steps.map((step,index)=>`<button class="step ${index===state.activeStep?'active':''} ${done[index]?'done':''}" data-step="${index}"><span>${String(index+1).padStart(2,'0')}</span>${step}</button>`).join('')}</nav><main class="page"><div class="page-head"><div><div class="eyebrow">${String(state.activeStep+1).padStart(2,'0')} / 04</div><h1>${title}</h1><p>${description}</p></div></div>${conflictBar()}${content}</main><div id="toast" class="toast" role="status" aria-live="polite"></div></div>`;
}
function copyPage(){
  if(state.parseReview)return reviewParsedPage();
  const placeholder=`SET 2 — The Journey of a Garment\n\nSlide 1 — It starts on a wall covered in paper. Everything still possible.\n\nSlide 2 — Then it reaches hands in India. Hands that have been stitching this way for generations.\n\nSlide 3 — The smallest details are always added last. That is where everything comes together.\n\nSlide 4 — What reaches you is not just one garment.\nCTA: See where it begins.`;
  return shell(`<div class="copy-layout"><section class="panel">${field('Paste Complete Story Set Copy',`<textarea id="rawInput" class="copy-editor" placeholder="${esc(placeholder)}">${esc(state.rawInput)}</textarea>`,'Paste one complete set or several SET blocks together. Exact wording is preserved.')}<div class="action-row">${btn('Parse Story Set','parse','primary')}${btn('Insert Slide Break','insertBreak','tertiary')}${btn('Save Draft','saveDraft')}${btn('Clear','clear','tertiary')}</div></section><aside class="panel guidance"><h2>Parser recognises</h2><p>Set titles, slide markers, CTA, Poll, Question, Direction, video/content descriptions, no-text-overlay and caption-CC instructions.</p><ul><li>Copy is never rewritten.</li><li>Several sets can be pasted together.</li><li>Nothing replaces project data until confirmation.</li></ul></aside></div>`,'Copy','Paste the complete story-set copy once, then review the detected structure.');
}
function reviewParsedPage(){
  const review=state.parseReview;
  const active=review.active??0;
  const set=review.sets[active];
  return shell(`<div class="review-layout"><aside class="panel review-summary"><div class="panel-head"><h2>${review.sets.length} set${review.sets.length===1?'':'s'} detected</h2>${badge(`${review.totalSlides} slides`)}</div>${review.sets.map((storySet,index)=>`<button class="review-set ${index===active?'active':''} ${storySet.included===false?'excluded':''}" data-review-set="${index}"><b>${esc(storySet.title)}</b><small>${storySet.slides.length} slides · ${storySet.parseWarnings.length} warnings</small></button>`).join('')}<div class="stack-actions">${btn('Confirm All Included Sets','confirmParsed','primary')}${btn('Re-parse','reparse')}${btn('Return to Raw Copy','backRaw','tertiary')}${btn('Cancel','cancelParse','danger')}</div></aside><section class="panel"><div class="panel-head"><div><div class="eyebrow">Review Parsed Story Set</div><h2>${esc(set.title)}</h2></div><label class="include-check"><input type="checkbox" id="includeSet" ${set.included===false?'':'checked'}> Include set</label></div>${field('Detected set title',`<input id="reviewTitle" value="${esc(set.title)}">`)}${set.parseWarnings.length?`<div class="warning-box">${set.parseWarnings.map(warning=>`<p>• ${esc(warning)}</p>`).join('')}</div>`:''}<div class="parsed-list">${set.slides.map((slide,index)=>`<article class="parsed-row"><div class="parsed-number">${n(index)}</div><div>${field('Exact overlay copy',`<textarea data-review-slide="${index}" data-key="overlay_text">${esc(slide.overlay_text)}</textarea>`)}<div class="form-grid">${field('CTA',`<input data-review-slide="${index}" data-key="cta" value="${esc(slide.cta)}">`)}${field('Interaction',`<input data-review-slide="${index}" data-key="interaction" value="${esc(slide.interaction)}">`)}</div>${field('Content / video description',`<input data-review-slide="${index}" data-key="content_description" value="${esc(slide.content_description)}">`)}${field('Direction',`<textarea data-review-slide="${index}" data-key="direction">${esc(slide.direction)}</textarea>`)}<div class="check-row"><label><input type="checkbox" data-review-check="${index}" data-key="no_text_overlay" ${slide.no_text_overlay?'checked':''}> No text overlay</label><label><input type="checkbox" data-review-check="${index}" data-key="caption_cc" ${slide.caption_cc?'checked':''}> Caption CC</label></div></div></article>`).join('')}</div></section></div>`,'Review Parsed Story Set','Check the parser result and correct individual fields before creating project data.');
}
function reviewStoryPage(){
  const set=current();
  const index=Math.min(state.selectedSlide,set.slides.length-1);
  const slide=set.slides[index];
  return shell(`<div class="set-strip panel"><div><b>${esc(set.title)}</b><small>${set.slides.length} slides · ${set.parseStatus}</small></div>${btn('Re-parse From Original Copy','reparseOriginal','tertiary')}</div><div class="master-detail"><aside class="panel story-list"><div class="panel-head"><h2>Slides</h2>${btn('+ Slide','addSlide','tertiary')}</div>${set.slides.map((item,itemIndex)=>`<button class="story-item ${itemIndex===index?'active':''}" data-slide="${itemIndex}"><span>${n(itemIndex)}</span><div><b>${esc((item.copy||item.content_description||`Slide ${itemIndex+1}`).slice(0,46))}</b><small>${esc(item.role||'Unassigned')}</small></div></button>`).join('')}</aside><section class="panel detail">${field('Story-set title',`<input id="setTitle" value="${esc(set.title)}">`)}${field('Overall Set Direction — Optional',`<textarea id="overallDirection" placeholder="Keep the complete set soft, tactile and intimate. Use one restrained recurring motif.">${esc(set.overallDirection)}</textarea>`,'Included in set analysis, matching and every prompt.')}<div class="panel-head"><div><div class="eyebrow">Slide ${n(index)}</div><h2>${esc(slide.role)}</h2></div><div class="mini-actions">${index>0?btn('Move Up','moveUp','tertiary'):''}${index<set.slides.length-1?btn('Move Down','moveDown','tertiary'):''}${set.slides.length>1?btn('Remove','removeSlide','danger'):''}</div></div><div class="form-grid">${field('Role in story arc',`<select data-slide-field="role"><option>Opening</option><option>Development</option><option>Engagement</option><option>Resolution / CTA</option></select>`)}${field('CTA',`<input data-slide-field="cta" value="${esc(slide.cta)}">`)}</div>${field('Exact overlay copy',`<textarea data-slide-field="copy">${esc(slide.copy)}</textarea>`)}${field('Interaction',`<input data-slide-field="interaction" value="${esc(slide.interaction)}">`)}${field('Content / video direction',`<input data-slide-field="content_description" value="${esc(slide.content_description)}">`)}${field('Slide-specific direction — Optional',`<textarea data-slide-field="direction">${esc(slide.direction)}</textarea>`)}<div class="check-row"><label><input type="checkbox" data-slide-check="no_text_overlay" ${slide.no_text_overlay?'checked':''}> No text overlay</label><label><input type="checkbox" data-slide-check="caption_cc" ${slide.caption_cc?'checked':''}> Caption CC</label></div></section></div>`,'Review Story','Review the confirmed copy, story arc, order and optional directions.');
}
function uploadBox(id,title,accept,multiple=true){return`<label class="upload-box"><b>${title}</b><small>${accept}</small><input id="${id}" type="file" accept="${accept}" ${multiple?'multiple':''}></label>`}
function filteredLibrary(items){
  const query=state.librarySearch.toLowerCase(),filter=state.libraryFilter;
  return items.filter(item=>(!query||[item.title,item.filename,item.description,item.media_category,(item.tags||[]).join(' ')].join(' ').toLowerCase().includes(query))&&(!filter||item.media_category===filter||item.type?.includes(filter)||item.library_type===filter));
}
function usageCount(item,type){
  return state.storySets.reduce((acc,set)=>acc+set.slides.filter(slide=>(type==='main'?slide.main?.id:slide.reference?.id)===item.id).length,0);
}
function recommendationCards(set,slide,index){
  const references=set.references.filter(item=>item.library_type==='reference');
  const recommendations=recommendReferencesForSlide(references,slide,set,{usedReferences:set.slides.map(item=>item.reference?.id).filter(Boolean),adjacentReferences:[set.slides[index-1]?.reference,set.slides[index+1]?.reference].filter(Boolean)});
  return`<div class="recommendations"><div class="panel-head"><h3>Recommended references</h3>${badge(`${recommendations.length} options`)}</div>${recommendations.length?`<div class="recommend-grid">${recommendations.map(item=>`<article class="recommend-card ${slide.reference?.id===item.item.id?'selected':''}">${preview(item.item)}<div><b>${esc(item.item.title||item.item.filename)}</b><small>Match ${item.score}/100</small><p>${esc(item.reason)}</p><div class="mini-actions"><button class="btn tertiary" data-use-reference="${index}:${item.item.id}">Use reference</button></div></div></article>`).join('')}</div>`:'<p class="empty-copy">No strong library reference match. Original Editorial Direction remains valid.</p>'}</div>`;
}
function library(title,items,type){
  const visible=filteredLibrary(items),categories=[...new Set(items.map(item=>item.media_category||item.library_type).filter(Boolean))].sort();
  return`<section class="panel library" data-library-type="${type}"><div class="panel-head"><div><h2>${title}</h2><p>${items.length} total · ${visible.length} shown</p></div>${badge(type==='main'?'Shared Media':'Shared References')}</div><div class="library-tools"><input data-library-search value="${esc(state.librarySearch)}" placeholder="Search libraries"><select data-library-filter><option value="">All filters</option>${categories.map(category=>`<option value="${esc(category)}" ${category===state.libraryFilter?'selected':''}>${esc(category)}</option>`).join('')}</select><button class="btn tertiary" data-toggle-library-view>${state.libraryView==='grid'?'List':'Grid'}</button></div><div class="${state.libraryView==='grid'?'library-grid':'library-list'}">${visible.length?visible.slice(0,80).map(item=>{const count=usageCount(item,type),filename=item.filename||item.title||'Untitled file';return`<article class="library-card ${item.archived_at?'archived':''}">${preview(item)}<div class="library-card-body"><b title="${esc(filename)}">${esc(item.title||filename)}</b><small title="${esc(filename)}">${esc(filename)} · ${esc(item.type)} · ${count} use${count===1?'':'s'}</small><small title="${esc(item.description||item.media_category||'')}">${esc(item.description||item.media_category||'No category')}</small></div><div class="mini-actions"><button class="btn tertiary" data-show-usage="${type}:${item.id}">Uses</button><button class="btn tertiary" data-archive-library="${type}:${item.id}">Archive</button><button class="btn danger" data-delete-library="${type}:${item.id}">Delete</button></div></article>`}).join(''):'<p class="empty-copy">No shared library items yet.</p>'}</div></section>`;
}
function referenceModeLabel(mode){return({library_reference:'Reference Library',manual_upload:'Slide-only upload',editorial_direction_only:'Original editorial direction'})[mode]||mode}
function assetsPage(){
  const set=current(),media=set.mainAssets.filter(item=>item.library_type==='media'),refs=set.references.filter(item=>item.library_type==='reference'),manualMedia=set.mainAssets.filter(item=>!item.library_type),manualRefs=set.references.filter(item=>!item.library_type);
  return shell(`<div class="upload-workspace panel"><div>${uploadBox('uploadMain','Upload to Media Library','image/jpeg,image/png,image/webp,image/heic,image/gif,video/mp4,video/quicktime,video/x-m4v,application/pdf')}</div><div>${uploadBox('uploadRefs','Upload to Reference Library','image/jpeg,image/png,image/webp,image/svg+xml,application/pdf')}</div></div><div class="libraries">${library('Media Asset Library',media,'main')}${library('Reference Library',refs,'ref')}</div><section class="assignments"><div class="section-title"><h2>Slide Assignments</h2><p>Assign reusable library items or slide-only uploads. Original Editorial Direction remains valid when no reference is selected.</p></div>${set.slides.map((slide,index)=>{const strategy=resolveReferenceStrategy(slide,index,set.slides,set);const ready=readiness([slide],set,set.logo)[0];return`<article class="assignment"><div class="assignment-head"><div><div class="eyebrow">Slide ${n(index)} · ${esc(slide.role)}</div><b>${esc((slide.copy||slide.content_description||'No visible copy').slice(0,105))}</b></div><div>${badge(referenceModeLabel(strategy.mode),strategy.mode==='editorial_direction_only'?'':'ok')} ${slide.referenceLocked?badge('Locked'):''} ${ready.ready?badge('Ready','ok'):badge('Incomplete','bad')}</div></div><div class="assignment-grid"><div>${field('Main media',`<select data-assign-main="${index}"><option value="">Choose from Media Library…</option>${[...media,...manualMedia].map(item=>`<option value="${item.id}" ${slide.main?.id===item.id?'selected':''}>${esc(item.title||item.filename)}</option>`).join('')}</select>`)}${uploadBox(`slideMain-${index}`,'Upload for this slide only','image/jpeg,image/png,image/webp,image/heic,image/gif,video/mp4,video/quicktime,video/x-m4v,application/pdf',false)}${preview(slide.main)}<div class="mini-actions"><button class="btn tertiary" data-clear-main="${index}">Remove assignment</button>${slide.main?`<button class="btn tertiary" data-show-usage="main:${slide.main.id}">Where used</button>`:''}</div></div><div>${field('Reference Mode',`<select data-reference-mode="${index}">${REFERENCE_MODES.map(mode=>`<option value="${mode}" ${slide.referenceMode===mode?'selected':''}>${referenceModeLabel(mode)}</option>`).join('')}</select>`)}${slide.referenceMode==='library_reference'?field('Reference Library',`<select data-assign-ref="${index}"><option value="">Choose from Reference Library…</option>${refs.map(item=>`<option value="${item.id}" ${slide.reference?.id===item.id?'selected':''}>${esc(item.title||item.filename)}</option>`).join('')}</select>`):''}${slide.referenceMode==='manual_upload'?field('Slide-only reference',`<select data-assign-ref="${index}"><option value="">Choose slide-only upload…</option>${manualRefs.map(item=>`<option value="${item.id}" ${slide.reference?.id===item.id?'selected':''}>${esc(item.filename)}</option>`).join('')}</select>`):''}${uploadBox(`slideRef-${index}`,'Upload for this slide only','image/jpeg,image/png,image/webp,application/pdf',false)}${slide.referenceMode==='editorial_direction_only'?`<div class="editorial-summary"><b>${esc(strategy.original_editorial_direction?.concept_title||'Original editorial direction')}</b><p>${esc(strategy.original_editorial_direction?.composition||'')}</p></div>`:preview(slide.reference)}<div class="mini-actions"><button class="btn tertiary" data-lock-ref="${index}">${slide.referenceLocked?'Unlock reference':'Lock reference'}</button><button class="btn tertiary" data-clear-ref="${index}">Remove assignment</button>${slide.reference?`<button class="btn tertiary" data-show-usage="ref:${slide.reference.id}">Where used</button>`:''}</div></div><div>${field('Slide-specific direction',`<textarea data-assignment-direction="${index}">${esc(slide.direction)}</textarea>`)}${strategy.match_reason?`<p class="match-reason">${esc(strategy.match_reason)}</p>`:''}</div></div>${refs.length?recommendationCards(set,slide,index):''}</article>`}).join('')}</section>`,'Assets & References','Use the shared Reference Library, shared Media Library, slide-only uploads or original editorial direction.');
}
function generatePage(){
  const set=current();
  const status=rows();
  const ready=status.every(row=>row.ready);
  const complete=fullJson();
  return shell(`<section class="panel"><div class="panel-head"><div><h2>Story-set readiness</h2><p>${status.filter(row=>row.ready).length} of ${status.length} slides ready</p></div>${ready?badge('Ready','ok'):badge('Blocked','bad')}</div><div class="table-wrap"><table><thead><tr><th>Slide</th><th>Main Asset</th><th>Reference Strategy</th><th>JSON</th><th>Ready</th></tr></thead><tbody>${status.map(row=>`<tr><td>${n(row.slide-1)}</td><td>${row.main?'Ready':'Missing'}</td><td>${esc(referenceModeLabel(row.referenceMode))}</td><td>${row.json?'Valid':'Invalid'}</td><td>${row.ready?badge('Ready','ok'):`<span class="missing">${esc(row.missing.join(', '))}</span>`}</td></tr>`).join('')}</tbody></table></div></section><section class="panel bulk-panel"><div><div class="eyebrow">Bulk Story-Set Generation</div><h2>${esc(set.title)}</h2><p>${set.slides.length} slides · JSON ${parseJson(complete).ok?'valid':'invalid'}</p></div><div class="bulk-actions">${btn('Copy Full Story-Set JSON','copyFull','primary')}${btn('Download Full Story-Set JSON','downloadFull')}${btn('Download Full Story-Set ZIP','downloadZip','primary',ready?'':'disabled')}${btn('Download Incomplete Draft Package','downloadDraft','tertiary')}</div></section>${ready?'':`<p class="missing">This story set is not ready for bulk generation. Resolve the highlighted slide requirements first.</p>`}<details class="json-panel" open><summary>Formatted full story-set JSON</summary><pre>${esc(complete)}</pre></details><div class="section-title"><h2>Individual Generation</h2><p>Every prompt includes story role, exact copy, reference strategy, selected visual logic and continuity.</p></div><div class="production-grid">${set.slides.map((slide,index)=>{const row=status[index];const json=pretty(slidePrompt(slide,index,set.slides,set,set.logo));const strategy=resolveReferenceStrategy(slide,index,set.slides,set);return`<article class="production-card"><div class="card-top"><div><div class="eyebrow">Slide ${n(index)}</div><b>${esc(slide.role)}</b></div>${row.ready?badge('Ready','ok'):badge('Blocked','bad')}</div><div class="preview-pair"><div>${preview(slide.main)}<small>Source</small></div><div>${strategy.mode==='editorial_direction_only'?'<div class="file-tile">EDITORIAL</div>':preview(slide.reference)}<small>${esc(referenceModeLabel(strategy.mode))}</small></div></div><p class="copy-excerpt">${esc(slide.copy||slide.content_description||'No visible overlay copy')}</p><p class="match-reason">${esc(strategy.match_reason||strategy.original_editorial_direction?.narrative_intention||'')}</p><div class="card-actions"><button class="btn tertiary" data-action="copy" data-i="${index}">Copy Slide JSON</button><button class="btn tertiary" data-action="json" data-i="${index}">Download Slide JSON</button><button class="btn tertiary" data-action="package" data-i="${index}">Download Slide Package</button><button class="btn tertiary" data-action="validate" data-i="${index}">Validate Slide JSON</button><button class="btn tertiary" data-action="view" data-i="${index}">View JSON</button></div><details id="json-${index}" class="json-panel"><summary>Slide JSON</summary><pre>${esc(json)}</pre></details></article>`}).join('')}</div>`,'Generate','Validate and export individual slides or the complete story set.');
}
function configPage(){return`<div class="auth-shell"><div class="auth-card"><h1>LadyTin Story Studio</h1><p>Cloud collaboration is not configured for this build yet.</p><p>Set these environment variables and rebuild:</p><ul class="config-list">${missingConfig().map(key=>`<li>${key}</li>`).join('')}</ul><p class="auth-note">Locally: copy .env.example to .env, fill the values and run npm run build. On Vercel: add them as project environment variables.</p></div></div>`}
function projectsPage(){
  const migratable=!cloud.migrationComplete()&&((Array.isArray(stored.storySets)&&stored.storySets.length)||(Array.isArray(stored.slides)&&stored.slides.length));
  return`<div class="projects-page"><div class="panel-head"><div><h1>Projects</h1></div><div class="mini-actions">${btn('New Project','newProject','primary')}${btn('Sign Out','signOut','tertiary')}</div></div>${cloudState.projects.length?cloudState.projects.map(project=>`<div class="project-row"><div><b>${esc(project.title)}</b><small>Updated ${new Date(project.updated_at).toLocaleString()}</small></div><div class="mini-actions">${btn('Open',`open-${project.id}`,'secondary',`data-open-project="${project.id}"`)}${btn('Rename',`ren-${project.id}`,'tertiary',`data-rename-project="${project.id}"`)}${btn('Delete',`del-${project.id}`,'danger',`data-delete-project="${project.id}"`)}</div></div>`).join(''):'<p class="empty-copy">No projects yet. Create your first project.</p>'}${migratable?`<div class="migrate-box"><b>Import this browser’s existing LadyTin project</b><p>Your earlier browser-local project can be moved into the cloud. Files whose original bytes are no longer in this browser session are imported as metadata and must be re-uploaded.</p><div class="action-row">${btn('Import Browser Project','migrateLocal','secondary')}</div></div>`:''}${cloudState.migrationResult?.warnings?.length?`<div class="warning-box">${cloudState.migrationResult.warnings.map(warning=>`<p>• ${esc(warning)}</p>`).join('')}</div>`:''}</div>`;
}
function loadingPage(message){return`<div class="auth-shell"><div class="auth-card"><h1>LadyTin Story Studio</h1><p>${esc(message)}</p></div></div>`}
function render(){
  const root=$('#root');
  if(cloudState.view==='config')return void(root.innerHTML=configPage());
  if(cloudState.view==='loading')return void(root.innerHTML=loadingPage('Restoring your session…'));
  if(cloudState.view==='loadingProject')return void(root.innerHTML=loadingPage('Opening project…'));
  if(cloudState.view==='projects'){root.innerHTML=projectsPage();return wireProjects()}
  const views=[copyPage,reviewStoryPage,assetsPage,generatePage];
  root.innerHTML=views[state.activeStep]();
  wire();
  renderSaveState();
}
function parseNow(){if(!state.rawInput.trim())return toast('Paste complete story-set copy first.','bad');const result=parseStorySets(state.rawInput);state.parseReview={...result,active:0};render()}
function confirmReview(){const sets=state.parseReview.sets.filter(set=>set.included!==false).map(normaliseSet);if(!sets.length)return toast('Include at least one story set.','bad');sets.forEach(set=>set.parseStatus='confirmed');state.storySets=sets;state.activeSet=0;state.selectedSlide=0;state.parseReview=null;state.activeStep=1;save(true);render();toast(`${sets.length} story set${sets.length===1?'':'s'} created.`)}
function recalcSet(){const set=current(),references=set.references.filter(item=>item.library_type==='reference');applyReferencePlan(set,buildReferencePlan(set,references));save(true);render();toast(references.length?'Reference recommendations recalculated.':'Original Editorial Direction applied where no reference is selected.')}

function wire(){
  $('#saveProject')?.addEventListener('click',()=>{save();toast('Project saved.')});
  $('#continue')?.addEventListener('click',()=>setStep(state.activeStep+1));
  $('#setPicker')?.addEventListener('change',event=>{state.activeSet=+event.target.value;state.selectedSlide=0;save();render()});
  $$('[data-step]').forEach(button=>button.onclick=()=>setStep(+button.dataset.step));
  $('#rawInput')?.addEventListener('input',event=>{state.rawInput=event.target.value;save()});
  $('#parse')?.addEventListener('click',parseNow);
  $('#insertBreak')?.addEventListener('click',()=>{const textarea=$('#rawInput');const start=textarea.selectionStart;state.rawInput=state.rawInput.slice(0,start)+'\n\nSLIDE BREAK\n\n'+state.rawInput.slice(textarea.selectionEnd);render()});
  $('#saveDraft')?.addEventListener('click',()=>{save();toast('Draft saved.')});
  $('#clear')?.addEventListener('click',()=>{state.rawInput='';save();render()});
  $$('[data-review-set]').forEach(button=>button.onclick=()=>{state.parseReview.active=+button.dataset.reviewSet;render()});
  $('#includeSet')?.addEventListener('change',event=>{state.parseReview.sets[state.parseReview.active].included=event.target.checked;render()});
  $('#reviewTitle')?.addEventListener('input',event=>state.parseReview.sets[state.parseReview.active].title=event.target.value);
  $$('[data-review-slide]').forEach(element=>element.oninput=event=>{const slide=state.parseReview.sets[state.parseReview.active].slides[+element.dataset.reviewSlide];slide[element.dataset.key]=event.target.value;if(element.dataset.key==='overlay_text')slide.copy=event.target.value;if(element.dataset.key==='direction')slide.art=event.target.value});
  $$('[data-review-check]').forEach(element=>element.onchange=event=>state.parseReview.sets[state.parseReview.active].slides[+element.dataset.reviewCheck][element.dataset.key]=event.target.checked);
  $('#confirmParsed')?.addEventListener('click',confirmReview);
  $('#reparse')?.addEventListener('click',parseNow);
  $('#backRaw')?.addEventListener('click',()=>{state.parseReview=null;render()});
  $('#cancelParse')?.addEventListener('click',()=>{state.parseReview=null;render()});
  $('#setTitle')?.addEventListener('input',event=>{current().title=event.target.value;save()});
  $('#overallDirection')?.addEventListener('input',event=>{current().overallDirection=event.target.value;save()});
  $('#reparseOriginal')?.addEventListener('click',()=>{if(confirm('Re-parsing may replace manual copy edits. Continue?')){state.rawInput=current().rawStorySetCopy||state.rawInput;state.activeStep=0;parseNow()}});
  $$('[data-slide]').forEach(button=>button.onclick=()=>{state.selectedSlide=+button.dataset.slide;void updatePresence({activity:'viewing',context:`Slide ${n(state.selectedSlide)}`});savePrefs();render()});
  if($('[data-slide-field="role"]'))$('[data-slide-field="role"]').value=current().slides[state.selectedSlide].role;
  $$('[data-slide-field]').forEach(element=>element.oninput=event=>{const slide=current().slides[state.selectedSlide];const key=element.dataset.slideField;slide[key]=event.target.value;if(key==='copy')slide.overlay_text=event.target.value;if(key==='direction')slide.art=event.target.value;save()});
  $$('[data-slide-check]').forEach(element=>element.onchange=event=>{current().slides[state.selectedSlide][element.dataset.slideCheck]=event.target.checked;save()});
  $('#addSlide')?.addEventListener('click',()=>{current().slides.push(normaliseSlide(makeSlide(current().slides.length+1),current().slides.length,current()));state.selectedSlide=current().slides.length-1;save(true);render()});
  $('#removeSlide')?.addEventListener('click',()=>{current().slides.splice(state.selectedSlide,1);current().slides.forEach((slide,index)=>slide.slide_number=index+1);state.selectedSlide=Math.max(0,state.selectedSlide-1);save(true);render()});
  $('#moveUp')?.addEventListener('click',()=>{const slides=current().slides;const index=state.selectedSlide;[slides[index-1],slides[index]]=[slides[index],slides[index-1]];state.selectedSlide--;slides.forEach((slide,itemIndex)=>slide.slide_number=itemIndex+1);save(true);render()});
  $('#moveDown')?.addEventListener('click',()=>{const slides=current().slides;const index=state.selectedSlide;[slides[index+1],slides[index]]=[slides[index],slides[index+1]];state.selectedSlide++;slides.forEach((slide,itemIndex)=>slide.slide_number=itemIndex+1);save(true);render()});

  const addLibraryFiles=(input,libraryType,key)=>input?.addEventListener('change',async event=>{const files=[...event.target.files];if(!files.length)return;try{for(const file of files){const uploaded=await cloud.uploadLibraryItem({file,libraryType,userId:cloudState.auth.user.id});state.storySets.forEach(set=>set[key]=[uploaded,...set[key].filter(item=>item.id!==uploaded.id)])}save(true);render();toast(`${files.length} file${files.length===1?'':'s'} uploaded to the shared library.`)}catch(error){console.error(error);toast(error.message,'bad');render()}});
  const addSlideFile=(input,index,key,assetType)=>input?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{if(!isUuid(current().id))await flushNow();const uploaded=await cloud.uploadAsset({projectId:cloudState.project.id,storySetId:current().id,file,assetType,userId:cloudState.auth.user.id});const slide=current().slides[index];current()[key].push(uploaded);if(assetType==='main'){slide.main=uploaded;slide.assetId=uploaded.id;slide.mainAssetSource='manual_upload'}else{slide.reference=uploaded;slide.referenceId=uploaded.id;slide.referenceMode='manual_upload'}save(true);render();toast('Slide-only upload assigned.')}catch(error){console.error(error);toast(error.message,'bad');render()}});
  addLibraryFiles($('#uploadMain'),'media','mainAssets');
  addLibraryFiles($('#uploadRefs'),'reference','references');
  $$('input[id^="slideMain-"]').forEach(input=>addSlideFile(input,Number(input.id.split('-')[1]),'mainAssets','main'));
  $$('input[id^="slideRef-"]').forEach(input=>addSlideFile(input,Number(input.id.split('-')[1]),'references','reference'));
  $$('[data-library-search]').forEach(input=>input.addEventListener('input',event=>{state.librarySearch=event.target.value;render()}));
  $$('[data-library-filter]').forEach(select=>select.addEventListener('change',event=>{state.libraryFilter=event.target.value;render()}));
  $$('[data-toggle-library-view]').forEach(button=>button.addEventListener('click',()=>{state.libraryView=state.libraryView==='grid'?'list':'grid';render()}));
  $$('[data-archive-library]').forEach(button=>button.onclick=async()=>{const[,id]=button.dataset.archiveLibrary.split(':');try{await cloud.archiveLibraryItem(id);state.storySets.forEach(set=>{set.mainAssets=set.mainAssets.filter(item=>item.id!==id);set.references=set.references.filter(item=>item.id!==id)});toast('Library item archived. Existing slide assignments remain intact.');render()}catch(error){toast(error.message,'bad')}});
  $$('[data-delete-library]').forEach(button=>button.onclick=async()=>{const[,id]=button.dataset.deleteLibrary.split(':');try{await cloud.deleteUnusedLibraryItem(id);state.storySets.forEach(set=>{set.mainAssets=set.mainAssets.filter(item=>item.id!==id);set.references=set.references.filter(item=>item.id!==id)});toast('Unused library item deleted.');render()}catch(error){toast(`${error.message} Archive it instead if it is still assigned.`,'bad')}});
  $$('[data-show-usage]').forEach(button=>button.onclick=async()=>{const[,id]=button.dataset.showUsage.split(':');const local=state.storySets.flatMap(set=>set.slides.map((slide,index)=>({set:set.title,slide:index+1,main:slide.main?.id===id,ref:slide.reference?.id===id}))).filter(row=>row.main||row.ref);try{const remote=await cloud.getLibraryItemUsage(id);toast(local.length?`Used in ${local.length} visible slide${local.length===1?'':'s'}.`:`${remote.length||0} remote uses found.`)}catch{toast(local.length?`Used in ${local.length} visible slide${local.length===1?'':'s'}.`:'No visible uses found.')}});
  $$('[data-clear-main]').forEach(button=>button.onclick=()=>{const slide=current().slides[+button.dataset.clearMain];slide.main=null;slide.assetId='';save(true);render()});
  $$('[data-assign-main]').forEach(element=>element.onchange=event=>{const index=+element.dataset.assignMain,item=current().mainAssets.find(asset=>asset.id===event.target.value)||null;const slide=current().slides[index];slide.main=item;slide.assetId=event.target.value;slide.mainAssetSource=item?.library_type==='media'?'library_media':'manual_upload';save(true);render()});
  $$('[data-reference-mode]').forEach(element=>element.onchange=event=>{const slide=current().slides[+element.dataset.referenceMode];slide.referenceMode=event.target.value;if(event.target.value==='editorial_direction_only'){slide.reference=null;slide.referenceId=''}save(true);render()});
  $$('[data-assign-ref]').forEach(element=>element.onchange=event=>{const index=+element.dataset.assignRef;const slide=current().slides[index];slide.reference=current().references.find(asset=>asset.id===event.target.value)||null;slide.referenceId=event.target.value;slide.referenceMode=slide.reference?.library_type==='reference'?'library_reference':'manual_upload';save(true);render()});
  $$('[data-assignment-direction]').forEach(element=>element.oninput=event=>{const slide=current().slides[+element.dataset.assignmentDirection];slide.direction=event.target.value;slide.art=event.target.value;save()});
  $$('[data-use-reference]').forEach(button=>button.onclick=()=>{const[index,id]=button.dataset.useReference.split(':');const slide=current().slides[+index];const item=current().references.find(ref=>ref.id===id);const recommendation=recommendReferencesForSlide(current().references.filter(ref=>ref.library_type==='reference'),slide,current()).find(ref=>ref.item.id===id);slide.referenceMode='library_reference';slide.reference=item;slide.referenceId=id;slide.referenceMatchScore=recommendation?.score??null;slide.referenceMatchReason=recommendation?.reason||'Selected by the user from the Reference Library.';save(true);render();toast(`Reference selected for Slide ${n(+index)}.`)});
  $$('[data-lock-ref]').forEach(button=>button.onclick=()=>{const slide=current().slides[+button.dataset.lockRef];slide.referenceLocked=!slide.referenceLocked;save(true);render()});
  $$('[data-clear-ref]').forEach(button=>button.onclick=()=>{const slide=current().slides[+button.dataset.clearRef];slide.reference=null;slide.referenceId='';slide.referenceMode='editorial_direction_only';slide.referenceLocked=false;save(true);render()});
  $('#navReferenceLibrary')?.addEventListener('click',()=>{state.activeStep=2;state.libraryFilter='reference';render()});
  $('#navMediaLibrary')?.addEventListener('click',()=>{state.activeStep=2;state.libraryFilter='media';render()});
  $('#copyFull')?.addEventListener('click',()=>cp(fullJson(),'Full story-set JSON copied.'));
  $('#downloadFull')?.addEventListener('click',()=>dl('bulk-story-set-prompt.json',fullJson()));
  $('#downloadZip')?.addEventListener('click',async()=>{try{dl(`LadyTin-${slug(current().title)}-bulk-generation-package.zip`,await makeZip(current().slides,current(),current().logo,false,cloud.resolveAssetBinary),'application/zip');toast('Story-set package downloaded.')}catch(error){console.error(error);toast(`Could not create the ZIP package: ${error.message}`,'bad')}});
  $('#downloadDraft')?.addEventListener('click',async()=>{try{dl(`LadyTin-${slug(current().title)}-incomplete-draft-package.zip`,await makeZip(current().slides,current(),current().logo,true,cloud.resolveAssetBinary),'application/zip');toast('Incomplete draft package downloaded.')}catch(error){console.error(error);toast(`Could not create the ZIP package: ${error.message}`,'bad')}});
  $$('[data-action]').forEach(button=>button.onclick=async()=>{const index=+button.dataset.i;const slide=current().slides[index];const json=pretty(slidePrompt(slide,index,current().slides,current(),current().logo));try{if(button.dataset.action==='copy')void cp(json,'Slide JSON copied.');if(button.dataset.action==='json')dl(`slide-${n(index)}-prompt.json`,json);if(button.dataset.action==='validate')toast(parseJson(json).ok?'Slide JSON is valid.':'Slide JSON is invalid.');if(button.dataset.action==='view')$('#json-'+index).open=!$('#json-'+index).open;if(button.dataset.action==='package')dl(`LadyTin-${slug(current().title)}-slide-${n(index)}-package.zip`,await makeSlideZip(slide,index,current().slides,current(),current().logo,cloud.resolveAssetBinary),'application/zip')}catch(error){console.error(error);toast(`Could not create the ZIP package: ${error.message}`,'bad')}});
  wireCloudTopbar();
}

function wireProjects(){
  $('#newProject')?.addEventListener('click',async()=>{const title=prompt('Project title','New LadyTin Project');if(!title)return;try{const project=await cloud.createProject(title,cloudState.auth.user);toast('Project created.');await openProject(project.id)}catch(error){toast(error.message,'bad')}});
  $('#signOut')?.addEventListener('click',doSignOut);
  $('#migrateLocal')?.addEventListener('click',async()=>{toast('Importing browser project…');try{const result=await cloud.migrateLocalProject(cloudState.auth.user,stored,stored.storySets);cloudState.migrationResult=result;if(result.ok){toast('Browser project imported.');if(result.warnings.length)toast(`${result.warnings.length} file${result.warnings.length===1?'':'s'} need re-uploading — see the notes below.`,'bad');cloudState.projects=await cloud.listProjects();render()}else toast(result.reason,'bad')}catch(error){toast(`Migration failed: ${error.message}`,'bad')}});
  $$('[data-open-project]').forEach(button=>button.onclick=()=>openProject(button.dataset.openProject));
  $$('[data-rename-project]').forEach(button=>button.onclick=async()=>{const project=cloudState.projects.find(item=>item.id===button.dataset.renameProject);const title=prompt('Rename project',project?.title||'');if(!title)return;try{await cloud.renameProject(button.dataset.renameProject,title);cloudState.projects=await cloud.listProjects();render()}catch(error){toast(error.message,'bad')}});
  $$('[data-delete-project]').forEach(button=>button.onclick=async()=>{const project=cloudState.projects.find(item=>item.id===button.dataset.deleteProject);if(!confirm(`Delete "${project?.title}" permanently, including its story sets, slides and files?`))return;try{await cloud.deleteProject(button.dataset.deleteProject);cloudState.projects=await cloud.listProjects();toast('Project deleted.');render()}catch(error){toast(error.message,'bad')}});
}
function wireCloudTopbar(){
  $('#backProjects')?.addEventListener('click',async()=>{await flushNow();history.pushState({},'','/');await showProjects()});
  $('#signOut')?.addEventListener('click',doSignOut);
  $('#conflictReload')?.addEventListener('click',async()=>{const conflict=cloudState.conflict;cloudState.conflict=null;if(conflict?.kind==='slide'&&conflict.remote){const set=state.storySets.find(item=>item.id===conflict.setId);const index=set?.slides.findIndex(slide=>slide.id===conflict.id);if(set&&index>-1){const assetsById={};[...set.mainAssets,...set.references,...(set.logo?[set.logo]:[])].forEach(asset=>assetsById[asset.id]=asset);set.slides[index]=normaliseSlide(rowToSlide(conflict.remote,assetsById),index,set);set.slides[index].revision=Number(conflict.remote.revision)||1;snapEntity('slide',conflict.id,slideToRow(set.slides[index],set.id),set.slides[index].revision,set.id)}}if(conflict?.kind==='story_set'&&conflict.remote){const set=state.storySets.find(item=>item.id===conflict.id);if(set)Object.assign(set,{title:conflict.remote.title,overallDirection:conflict.remote.overallDirection,rawStorySetCopy:conflict.remote.rawStorySetCopy,revision:conflict.remote.revision})}cloudState.saveState='saved';render()});
  $('#conflictOverwrite')?.addEventListener('click',async()=>{const conflict=cloudState.conflict;cloudState.conflict=null;try{if(conflict?.kind==='slide'){const result=await cloud.overwriteSlide(conflict.id,conflict.localRow);if(!result.conflict){const set=state.storySets.find(item=>item.id===conflict.setId);const slide=set?.slides.find(item=>item.id===conflict.id);if(slide){slide.revision=result.row.revision;snapEntity('slide',conflict.id,slideToRow(slide,set.id),slide.revision,set.id)}}}if(conflict?.kind==='story_set'){const set=state.storySets.find(item=>item.id===conflict.id);if(set){const remoteResult=await cloud.updateStorySetGuarded(set.id,conflict.remote?.revision||1,storySetToRow(set,cloudState.project.id));if(!remoteResult.conflict){set.revision=remoteResult.row.revision;snapEntity('story_set',set.id,storySetToRow(set,cloudState.project.id),set.revision)}}}toast('Your version was saved.');cloudState.saveState='saved'}catch(error){toast(error.message,'bad')}render()});
}
async function doSignOut(){await flushNow();unsubscribeAll();await cloud.signOut();location.reload()}
function assetsIndex(){const map={};for(const set of state.storySets)for(const asset of[...set.mainAssets,...set.references,...(set.logo?[set.logo]:[])])map[asset.id]=asset;return map}
function onRealtimeEvent(event){
  if(cloudState.view!=='studio'||event.table==='project_members')return;
  const applied=applyRealtimeEvent({project:cloudState.project,storySets:state.storySets},event,assetsIndex());
  if(applied.deleted){toast('This project was deleted.','bad');history.pushState({},'','/');return showProjects()}
  cloudState.project=applied.project;
  state.storySets=applied.storySets;
  if(event.table==='story_sets'&&event.row?.id){const set=state.storySets.find(item=>item.id===event.row.id);if(set)snapEntity('story_set',set.id,storySetToRow(set,cloudState.project.id),set.revision)}
  if(event.table==='slides'&&event.row?.id){const set=state.storySets.find(item=>item.id===event.row.story_set_id);const slide=set?.slides.find(item=>item.id===event.row.id);if(slide)snapEntity('slide',slide.id,slideToRow(slide,set.id),slide.revision,set.id)}
  if(event.table==='story_sets'&&event.type==='INSERT')resubscribe();
  if(!state.storySets.length)state.storySets=[defaultSet()];
  state.activeSet=Math.min(state.activeSet,state.storySets.length-1);
  state.selectedSlide=Math.min(state.selectedSlide,(current()?.slides.length||1)-1);
  render();
}
function resubscribe(){if(cloudState.project)subscribeToProject(cloudState.project.id,state.storySets.map(set=>set.id).filter(isUuid),onRealtimeEvent)}
function routeProjectId(){const match=location.pathname.match(/^\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);return match?match[1]:null}
async function openProject(projectId,push=true){
  try{
    cloudState.view='loadingProject';
    render();
    const hydrated=await cloud.loadProject(projectId);
    cloudState.project=hydrated.project;
    cloudState.role='editor';
    cloudState.conflict=null;
    state.storySets=(hydrated.storySets.length?hydrated.storySets:[]).map(source=>{const set=normaliseSet(source);set.cloudId=set.id;set.revision=source.revision;set.slides.forEach((slide,index)=>{const original=source.slides[index];if(original){slide.revision=original.revision;slide.storySetId=original.storySetId}});return set});
    if(!state.storySets.length)state.storySets=[defaultSet()];
    state.activeSet=0;
    state.selectedSlide=0;
    state.rawInput=state.storySets[0]?.rawStorySetCopy||'';
    state.parseReview=null;
    rebuildSnapshot();
    cloudState.view='studio';
    resubscribe();
    joinPresence(projectId,{user_id:cloudState.auth.user.id,name:'Collaborator',activity:'viewing',context:steps[state.activeStep]},list=>{cloudState.presence=list;if(cloudState.view==='studio')render()});
    if(push)history.pushState({},'',`/project/${projectId}`);
    render();
  }catch(error){
    console.error(error);
    toast(`Could not open the project: ${error.message}`,'bad');
    await showProjects();
  }
}
async function showProjects(){
  unsubscribeAll();
  cloudState.view='projects';
  cloudState.project=null;
  cloudState.presence=[];
  try{cloudState.projects=await cloud.listProjects()}catch(error){toast(error.message,'bad')}
  render();
}
document.addEventListener('input',()=>{
  if(cloudState.view!=='studio')return;
  const context=state.activeStep===1?`Slide ${n(Math.min(state.selectedSlide,current().slides.length-1))}`:steps[state.activeStep];
  void updatePresence({activity:'editing',context});
  clearTimeout(presenceEditTimer);
  presenceEditTimer=setTimeout(()=>void updatePresence({activity:'viewing',context}),6000);
},true);
window.addEventListener('popstate',()=>{if(!cloudState.auth.user)return;const id=routeProjectId();if(id)void openProject(id,false);else void showProjects()});
window.addEventListener('beforeunload',()=>{if(editable())savePrefs()});

async function boot(){
  if(!isConfigured()){cloudState.view='config';return render()}
  cloudState.view='loading';
  render();
  const{data,error}=await supabase.auth.getSession();
  const session=data?.session;
  if(error||!session?.user){location.reload();return}
  cloudState.auth.user=session.user;
  supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')location.reload()});
  const routed=routeProjectId();
  if(routed)return openProject(routed,false);
  return showProjects();
}

void boot();
