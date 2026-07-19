import {bulkPrompt,makeSlideZip,makeZip,n,parseJson,pretty,readiness,slidePrompt,slug} from './prompting.js';
import {makeSlide,parseStorySets} from './parser.js';
import {PINTEREST_BOARD_URL,REFERENCE_MODES,applyReferencePlan,buildReferencePlan,parseBoardSnapshot,recommendPinsForSlide,resolveReferenceStrategy} from './pinterest.js';
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
  pinterestBoardUrl:PINTEREST_BOARD_URL,
  pinterestPins:[],
  pinterestSyncedAt:'',
  pinterestConnected:false,
  pinterestSnapshotImported:false,
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
        ? 'manual_upload'
        : set?.pinterestConnected
          ? 'pinterest_auto'
          : 'editorial_direction_only',
    pinterestPinId:slide.pinterestPinId||'',
    pinterestMatchScore:slide.pinterestMatchScore??null,
    pinterestMatchReason:slide.pinterestMatchReason||'',
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
    pinterestBoardUrl:input.pinterestBoardUrl||PINTEREST_BOARD_URL,
    pinterestPins:input.pinterestPins||[],
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
  pinterestSearch:'',
  pinterestFilter:'',
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
  if(asset.type?.startsWith('image/')&&asset.file)return`<img class="thumb" src="${URL.createObjectURL(asset.file)}" alt="">`;
  if(asset.type?.startsWith('video/'))return'<div class="file-tile">VIDEO</div>';
  if(asset.type==='application/pdf')return'<div class="file-tile">PDF</div>';
  return'<div class="file-tile">FILE</div>';
}
function pinThumb(pin){return pin?.thumbnail_url?`<img class="pin-thumb" src="${esc(pin.thumbnail_url)}" alt="${esc(pin.title)}" loading="lazy" referrerpolicy="no-referrer">`:'<div class="file-tile">PIN</div>'}
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
  return`<div class="app-shell"><header class="topbar"><div><b>LadyTin Story Studio</b><span class="project-status">${esc(set.title)}</span></div><div class="top-actions">${presenceStrip()}<span id="saveState" class="save-state">Saved</span>${btn('Projects','backProjects','tertiary')}<select id="setPicker" aria-label="Active story set">${state.storySets.map((storySet,index)=>`<option value="${index}" ${index===state.activeSet?'selected':''}>${String(index+1).padStart(2,'0')} · ${esc(storySet.title)}</option>`).join('')}</select>${btn('Save Project','saveProject')}${state.activeStep<3?btn('Continue','continue','primary'):''}${btn('Sign Out','signOut','tertiary')}</div></header><nav class="stepper" aria-label="Workflow">${steps.map((step,index)=>`<button class="step ${index===state.activeStep?'active':''} ${done[index]?'done':''}" data-step="${index}"><span>${String(index+1).padStart(2,'0')}</span>${step}</button>`).join('')}</nav><main class="page"><div class="page-head"><div><div class="eyebrow">${String(state.activeStep+1).padStart(2,'0')} / 04</div><h1>${title}</h1><p>${description}</p></div></div>${conflictBar()}${content}</main><div id="toast" class="toast" role="status" aria-live="polite"></div></div>`;
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
function library(title,items,type){
  return`<section class="panel library"><div class="panel-head"><h2>${title}</h2>${badge(`${items.length} files`)}</div><div class="library-grid">${items.length?items.map(item=>{const count=current().slides.filter(slide=>(type==='main'?slide.main?.id:slide.reference?.id)===item.id).length;return`<article class="library-card">${preview(item)}<div><b title="${esc(item.filename)}">${esc(item.filename)}</b><small>${esc(item.type)} · ${count} slide${count===1?'':'s'}</small></div><button class="icon-btn" data-remove-library="${type}:${item.id}" aria-label="Remove ${esc(item.filename)}">×</button></article>`}).join(''):'<p class="empty-copy">No files uploaded yet.</p>'}</div></section>`;
}
function filteredPins(set){
  const query=state.pinterestSearch.toLowerCase();
  const filter=state.pinterestFilter;
  return set.pinterestPins.filter(pin=>(!query||[pin.title,pin.description,Object.values(pin.visual_tags||{}).flat().join(' ')].join(' ').toLowerCase().includes(query))&&(!filter||Object.values(pin.visual_tags||{}).flat().includes(filter)));
}
function pinterestPanel(set){
  const pins=filteredPins(set);
  const allTags=[...new Set(set.pinterestPins.flatMap(pin=>Object.values(pin.visual_tags||{}).flat()))].sort();
  return`<section class="panel pinterest-panel"><div class="panel-head"><div><div class="eyebrow">Primary reference library</div><h2>Pinterest Board</h2><p>${esc(set.pinterestBoardUrl)}</p></div>${set.pinterestConnected?badge('Connected','ok'):set.pinterestSnapshotImported?badge('Snapshot imported','ok'):badge('Not connected')}</div><div class="pinterest-stats"><span>${set.pinterestPins.length} Pins</span><span>${set.pinterestSyncedAt?`Last synced ${new Date(set.pinterestSyncedAt).toLocaleString()}`:'Not synced'}</span></div><div class="action-row">${btn('Connect Pinterest','connectPinterest','primary')}${btn('Sync Board','syncPinterest','secondary',set.pinterestConnected?'':'disabled')}${btn('Recalculate Recommendations','recalculatePins','secondary',set.pinterestPins.length?'':'disabled')}${btn('Disconnect Pinterest','disconnectPinterest','tertiary',set.pinterestConnected?'':'disabled')}</div><div class="snapshot-import">${field('Import Pinterest Board Snapshot',`<textarea id="snapshotText" placeholder="Paste Pinterest JSON export or one Pin URL per line"></textarea>`,'Official OAuth remains the production path. Snapshot import is the supported fallback when API credentials or approval are unavailable.')}<div class="action-row">${btn('Import Snapshot','importSnapshot','secondary')}${uploadBox('snapshotFile','Choose JSON Snapshot','application/json,text/plain',false)}</div></div>${set.pinterestPins.length?`<div class="pin-tools"><input id="pinSearch" value="${esc(state.pinterestSearch)}" placeholder="Search Pins and inferred qualities"><select id="pinFilter"><option value="">All design qualities</option>${allTags.map(tag=>`<option ${tag===state.pinterestFilter?'selected':''}>${esc(tag)}</option>`).join('')}</select></div><div class="pin-grid">${pins.slice(0,60).map(pin=>`<article class="pin-card">${pinThumb(pin)}<div><b>${esc(pin.title)}</b><small>${esc(Object.values(pin.visual_tags||{}).flat().slice(0,5).join(' · '))}</small><p>${esc(pin.design_analysis?.summary||'')}</p><a href="${esc(pin.url)}" target="_blank" rel="noopener">Open Pin</a></div></article>`).join('')}</div>`:''}</section>`;
}
function recommendationCards(set,slide,index){
  const recommendations=recommendPinsForSlide(set.pinterestPins,slide,set,{usedPins:set.slides.map(item=>item.pinterestPinId).filter(Boolean),adjacentPins:[set.pinterestPins.find(pin=>pin.id===set.slides[index-1]?.pinterestPinId),set.pinterestPins.find(pin=>pin.id===set.slides[index+1]?.pinterestPinId)].filter(Boolean)});
  return`<div class="recommendations"><div class="panel-head"><h3>Recommended for this slide</h3>${badge(`${recommendations.length} options`)}</div>${recommendations.length?`<div class="recommend-grid">${recommendations.map(item=>`<article class="recommend-card ${slide.pinterestPinId===item.pin.id?'selected':''}">${pinThumb(item.pin)}<div><b>${esc(item.pin.title)}</b><small>Match ${item.score}/100</small><p>${esc(item.reason)}</p><div class="mini-actions"><button class="btn tertiary" data-use-pin="${index}:${item.pin.id}">Use this reference</button><a class="btn tertiary" href="${esc(item.pin.url)}" target="_blank" rel="noopener">Open Pin</a></div></div></article>`).join('')}</div>`:'<p class="empty-copy">No genuinely suitable Pin cleared the threshold. Original Editorial Direction will be used.</p>'}</div>`;
}
function referenceModeLabel(mode){return({pinterest_auto:'Pinterest Auto',pinterest_selected:'Pinterest Selected',manual_upload:'Manual reference',editorial_direction_only:'Original editorial direction'})[mode]||mode}
function assetsPage(){
  const set=current();
  return shell(`${pinterestPanel(set)}<div class="upload-workspace panel"><div>${uploadBox('uploadMain','Upload Main Assets','image/jpeg,image/png,image/webp,image/heic,image/gif,video/mp4,video/quicktime,video/x-m4v')}</div><div>${uploadBox('uploadRefs','Upload Manual References','image/jpeg,image/png,image/webp,application/pdf')}</div></div><div class="libraries">${library('Main Asset Library',set.mainAssets,'main')}${library('Manual Reference Library',set.references,'ref')}</div><section class="assignments"><div class="section-title"><h2>Slide Assignments</h2><p>Assign a source asset and choose one of four reference modes.</p></div>${set.slides.map((slide,index)=>{const strategy=resolveReferenceStrategy(slide,index,set.slides,set);const ready=readiness([slide],set,set.logo)[0];return`<article class="assignment"><div class="assignment-head"><div><div class="eyebrow">Slide ${n(index)} · ${esc(slide.role)}</div><b>${esc((slide.copy||slide.content_description||'No visible copy').slice(0,105))}</b></div><div>${badge(referenceModeLabel(strategy.mode),strategy.mode==='editorial_direction_only'?'':'ok')} ${slide.referenceLocked?badge('Locked'):''} ${ready.ready?badge('Ready','ok'):badge('Incomplete','bad')}</div></div><div class="assignment-grid"><div>${field('Main asset',`<select data-assign-main="${index}"><option value="">Select main asset…</option>${set.mainAssets.map(item=>`<option value="${item.id}" ${slide.main?.id===item.id?'selected':''}>${esc(item.filename)}</option>`).join('')}</select>`)}${preview(slide.main)}</div><div>${field('Reference Mode',`<select data-reference-mode="${index}">${REFERENCE_MODES.map(mode=>`<option value="${mode}" ${slide.referenceMode===mode?'selected':''}>${referenceModeLabel(mode)}</option>`).join('')}</select>`)}${slide.referenceMode==='manual_upload'?field('Manual reference',`<select data-assign-ref="${index}"><option value="">Select manual reference…</option>${set.references.map(item=>`<option value="${item.id}" ${slide.reference?.id===item.id?'selected':''}>${esc(item.filename)}</option>`).join('')}</select>`):''}${slide.referenceMode==='manual_upload'?preview(slide.reference):strategy.source==='pinterest'?pinThumb(set.pinterestPins.find(pin=>pin.id===strategy.pinterest_pin_id)||{}):`<div class="editorial-summary"><b>${esc(strategy.original_editorial_direction?.concept_title||'Original editorial direction')}</b><p>${esc(strategy.original_editorial_direction?.composition||'')}</p></div>`}<div class="mini-actions"><button class="btn tertiary" data-lock-ref="${index}">${slide.referenceLocked?'Unlock reference':'Lock reference'}</button><button class="btn tertiary" data-clear-ref="${index}">Clear selection</button></div></div><div>${field('Slide-specific direction — Optional',`<textarea data-assignment-direction="${index}">${esc(slide.direction)}</textarea>`)}${strategy.match_reason?`<p class="match-reason">${esc(strategy.match_reason)}</p>`:''}</div></div>${set.pinterestPins.length&&['pinterest_auto','pinterest_selected'].includes(slide.referenceMode)?recommendationCards(set,slide,index):''}</article>`}).join('')}</section>`,'Assets & References','Use Pinterest recommendations, a selected Pin, a manual reference or an original editorial direction.');
}
function generatePage(){
  const set=current();
  const status=rows();
  const ready=status.every(row=>row.ready);
  const complete=fullJson();
  return shell(`<section class="panel"><div class="panel-head"><div><h2>Story-set readiness</h2><p>${status.filter(row=>row.ready).length} of ${status.length} slides ready</p></div>${ready?badge('Ready','ok'):badge('Blocked','bad')}</div><div class="table-wrap"><table><thead><tr><th>Slide</th><th>Main Asset</th><th>Reference Strategy</th><th>JSON</th><th>Ready</th></tr></thead><tbody>${status.map(row=>`<tr><td>${n(row.slide-1)}</td><td>${row.main?'Ready':'Missing'}</td><td>${esc(referenceModeLabel(row.referenceMode))}</td><td>${row.json?'Valid':'Invalid'}</td><td>${row.ready?badge('Ready','ok'):`<span class="missing">${esc(row.missing.join(', '))}</span>`}</td></tr>`).join('')}</tbody></table></div></section><section class="panel bulk-panel"><div><div class="eyebrow">Complete story set</div><h2>${esc(set.title)}</h2><p>${set.slides.length} slides · JSON ${parseJson(complete).ok?'valid':'invalid'}</p></div><div class="bulk-actions">${btn('Copy Full Story-Set JSON','copyFull','primary')}${btn('Download Full Story-Set JSON','downloadFull')}${btn('Download Full Story-Set ZIP','downloadZip','primary',ready?'':'disabled')}${btn('Download Incomplete Draft Package','downloadDraft','tertiary')}</div></section><div class="section-title"><h2>Individual slides</h2><p>Every prompt includes story role, exact copy, reference strategy, selected visual logic and continuity.</p></div><div class="production-grid">${set.slides.map((slide,index)=>{const row=status[index];const json=pretty(slidePrompt(slide,index,set.slides,set,set.logo));const strategy=resolveReferenceStrategy(slide,index,set.slides,set);return`<article class="production-card"><div class="card-top"><div><div class="eyebrow">Slide ${n(index)}</div><b>${esc(slide.role)}</b></div>${row.ready?badge('Ready','ok'):badge('Blocked','bad')}</div><div class="preview-pair"><div>${preview(slide.main)}<small>Source</small></div><div>${strategy.source==='pinterest'?pinThumb(set.pinterestPins.find(pin=>pin.id===strategy.pinterest_pin_id)||{}):strategy.mode==='manual_upload'?preview(slide.reference):'<div class="file-tile">EDITORIAL</div>'}<small>${esc(referenceModeLabel(strategy.mode))}</small></div></div><p class="copy-excerpt">${esc(slide.copy||slide.content_description||'No visible overlay copy')}</p><p class="match-reason">${esc(strategy.match_reason||strategy.original_editorial_direction?.narrative_intention||'')}</p><div class="card-actions"><button class="btn tertiary" data-action="copyPrompt" data-i="${index}">Copy Prompt</button><button class="btn tertiary" data-action="copy" data-i="${index}">Copy JSON</button><button class="btn tertiary" data-action="json" data-i="${index}">Download JSON</button><button class="btn tertiary" data-action="package" data-i="${index}">Download Slide Package</button><button class="btn tertiary" data-action="recalculate" data-i="${index}">Regenerate Recommendations</button><button class="btn tertiary" data-action="view" data-i="${index}">View JSON</button></div><details id="json-${index}" class="json-panel"><summary>Slide JSON</summary><pre>${esc(json)}</pre></details></article>`}).join('')}</div>`,'Generate','Validate and export individual slides or the complete story set.');
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
function recalcSet(){const set=current();if(!set.pinterestPins.length){set.slides.forEach(slide=>{if(!slide.referenceLocked&&!slide.reference){slide.referenceMode='editorial_direction_only';slide.pinterestPinId=''}});save(true);return toast('No Pinterest library is available. Editorial Direction Only has been applied.')}applyReferencePlan(set,buildReferencePlan(set,set.pinterestPins));save(true);render();toast('Pinterest recommendations recalculated for the complete set.')}
async function importSnapshotText(text){const pins=parseBoardSnapshot(text,current().pinterestBoardUrl);if(!pins.length)throw new Error('No valid Pins were found in the snapshot.');const byId=new Map(current().pinterestPins.map(pin=>[pin.id,pin]));pins.forEach(pin=>byId.set(pin.id,pin));const merged=[...byId.values()];state.storySets.forEach(set=>{set.pinterestPins=merged;set.pinterestSnapshotImported=true;set.pinterestSyncedAt=new Date().toISOString()});if(editable()){if(!isUuid(current().id))await flushNow();await cloud.upsertPins(cloudState.project.id,pins)}recalcSet()}

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

  const addFiles=(input,key)=>input?.addEventListener('change',async event=>{const files=[...event.target.files];if(!files.length)return;try{if(!isUuid(current().id))await flushNow();for(const file of files){const uploaded=await cloud.uploadAsset({projectId:cloudState.project.id,storySetId:current().id,file,assetType:key==='mainAssets'?'main':'reference',userId:cloudState.auth.user.id});current()[key].push(uploaded)}save(true);render();toast(`${files.length} file${files.length===1?'':'s'} uploaded to project storage.`)}catch(error){console.error(error);toast(error.message,'bad');render()}});
  addFiles($('#uploadMain'),'mainAssets');
  addFiles($('#uploadRefs'),'references');
  $$('[data-remove-library]').forEach(button=>button.onclick=async()=>{const[type,id]=button.dataset.removeLibrary.split(':');const key=type==='main'?'mainAssets':'references';const target=current()[key].find(asset=>asset.id===id);current()[key]=current()[key].filter(asset=>asset.id!==id);current().slides.forEach(slide=>{if(type==='main'&&slide.main?.id===id){slide.main=null;slide.assetId=''}if(type==='ref'&&slide.reference?.id===id){slide.reference=null;slide.referenceId=''}});try{if(target?.storage_path)await cloud.deleteAsset(target)}catch(error){toast(error.message,'bad')}save(true);render()});
  $$('[data-assign-main]').forEach(element=>element.onchange=event=>{const index=+element.dataset.assignMain;current().slides[index].main=current().mainAssets.find(asset=>asset.id===event.target.value)||null;current().slides[index].assetId=event.target.value;save(true);render()});
  $$('[data-reference-mode]').forEach(element=>element.onchange=event=>{const slide=current().slides[+element.dataset.referenceMode];slide.referenceMode=event.target.value;if(event.target.value==='manual_upload')slide.pinterestPinId='';if(event.target.value==='editorial_direction_only'){slide.pinterestPinId='';slide.reference=null;slide.referenceId=''}save(true);render()});
  $$('[data-assign-ref]').forEach(element=>element.onchange=event=>{const index=+element.dataset.assignRef;const slide=current().slides[index];slide.reference=current().references.find(asset=>asset.id===event.target.value)||null;slide.referenceId=event.target.value;slide.referenceMode='manual_upload';slide.pinterestPinId='';save(true);render()});
  $$('[data-assignment-direction]').forEach(element=>element.oninput=event=>{const slide=current().slides[+element.dataset.assignmentDirection];slide.direction=event.target.value;slide.art=event.target.value;save()});
  $$('[data-use-pin]').forEach(button=>button.onclick=()=>{const[index,id]=button.dataset.usePin.split(':');const slide=current().slides[+index];const recommendation=recommendPinsForSlide(current().pinterestPins,slide,current()).find(item=>item.pin.id===id);slide.referenceMode='pinterest_selected';slide.pinterestPinId=id;slide.pinterestMatchScore=recommendation?.score??null;slide.pinterestMatchReason=recommendation?.reason||'Selected by the user from the Pinterest library.';slide.reference=null;slide.referenceId='';save(true);render();toast(`Pinterest reference selected for Slide ${n(+index)}.`)});
  $$('[data-lock-ref]').forEach(button=>button.onclick=()=>{const slide=current().slides[+button.dataset.lockRef];slide.referenceLocked=!slide.referenceLocked;save(true);render()});
  $$('[data-clear-ref]').forEach(button=>button.onclick=()=>{const slide=current().slides[+button.dataset.clearRef];slide.reference=null;slide.referenceId='';slide.pinterestPinId='';slide.referenceMode=current().pinterestConnected?'pinterest_auto':'editorial_direction_only';slide.referenceLocked=false;save(true);render()});
  $('#recalculatePins')?.addEventListener('click',recalcSet);
  $('#pinSearch')?.addEventListener('input',event=>{state.pinterestSearch=event.target.value;render()});
  $('#pinFilter')?.addEventListener('change',event=>{state.pinterestFilter=event.target.value;render()});
  $('#importSnapshot')?.addEventListener('click',async()=>{try{await importSnapshotText($('#snapshotText').value)}catch(error){toast(error.message,'bad')}});
  $('#snapshotFile')?.addEventListener('change',async event=>{try{await importSnapshotText(await event.target.files[0].text())}catch(error){toast(error.message,'bad')}});
  $('#connectPinterest')?.addEventListener('click',async()=>{try{const result=await cloud.pinterestAction('authorize',{project_id:cloudState.project.id});if(result?.authorize_url)location.href=result.authorize_url;else toast(result?.message||'Pinterest OAuth is not configured yet. Snapshot import and Original Editorial Direction remain available.','bad')}catch(error){toast(`Pinterest OAuth is not configured yet (${error.message}). Snapshot import and Original Editorial Direction remain available.`,'bad')}});
  $('#syncPinterest')?.addEventListener('click',async()=>{try{const result=await cloud.pinterestAction('sync',{project_id:cloudState.project.id});const fresh=await cloud.loadProject(cloudState.project.id);state.storySets.forEach(set=>{set.pinterestPins=fresh.storySets[0]?.pinterestPins||[];set.pinterestConnected=true;set.pinterestSyncedAt=new Date().toISOString()});toast(`Synced ${result?.count??''} Pins from the board.`);recalcSet()}catch(error){toast(`Pinterest sync failed: ${error.message}`,'bad')}});
  $('#disconnectPinterest')?.addEventListener('click',async()=>{try{await cloud.pinterestAction('disconnect',{project_id:cloudState.project.id})}catch{}current().pinterestConnected=false;current().slides.forEach(slide=>{if(!slide.referenceLocked&&slide.referenceMode==='pinterest_auto')slide.referenceMode='editorial_direction_only'});save(true);render();toast('Pinterest disconnected. Cached Pins remain available until removed.')});
  $('#copyFull')?.addEventListener('click',()=>cp(fullJson(),'Full story-set JSON copied.'));
  $('#downloadFull')?.addEventListener('click',()=>dl('bulk-story-set-prompt.json',fullJson()));
  $('#downloadZip')?.addEventListener('click',async()=>{try{dl(`LadyTin-${slug(current().title)}-bulk-generation-package.zip`,await makeZip(current().slides,current(),current().logo,false,cloud.resolveAssetBinary),'application/zip');toast('Story-set package downloaded.')}catch(error){console.error(error);toast(`Could not create the ZIP package: ${error.message}`,'bad')}});
  $('#downloadDraft')?.addEventListener('click',async()=>{try{dl(`LadyTin-${slug(current().title)}-incomplete-draft-package.zip`,await makeZip(current().slides,current(),current().logo,true,cloud.resolveAssetBinary),'application/zip');toast('Incomplete draft package downloaded.')}catch(error){console.error(error);toast(`Could not create the ZIP package: ${error.message}`,'bad')}});
  $$('[data-action]').forEach(button=>button.onclick=async()=>{const index=+button.dataset.i;const slide=current().slides[index];const json=pretty(slidePrompt(slide,index,current().slides,current(),current().logo));try{if(button.dataset.action==='copyPrompt'||button.dataset.action==='copy')void cp(json,button.dataset.action==='copyPrompt'?'Prompt copied.':'Slide JSON copied.');if(button.dataset.action==='json')dl(`slide-${n(index)}-prompt.json`,json);if(button.dataset.action==='view')$('#json-'+index).open=!$('#json-'+index).open;if(button.dataset.action==='recalculate'){slide.referenceLocked=false;const item=buildReferencePlan(current(),current().pinterestPins).slides[index];if(item?.selected_pin){slide.referenceMode='pinterest_auto';slide.pinterestPinId=item.selected_pin.id;slide.pinterestMatchScore=item.recommendations[0]?.score||null;slide.pinterestMatchReason=item.recommendations[0]?.reason||''}else{slide.referenceMode='editorial_direction_only';slide.pinterestPinId=''}save(true);render()}if(button.dataset.action==='package')dl(`LadyTin-${slug(current().title)}-slide-${n(index)}-package.zip`,await makeSlideZip(slide,index,current().slides,current(),current().logo,cloud.resolveAssetBinary),'application/zip')}catch(error){console.error(error);toast(`Could not create the ZIP package: ${error.message}`,'bad')}});
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
async function handlePinterestCallback(){
  const url=new URL(location.href);
  if(!location.pathname.startsWith('/project/pinterest/callback'))return false;
  const code=url.searchParams.get('code');
  const oauthState=url.searchParams.get('state');
  try{
    const result=await cloud.pinterestAction('callback',{code,state:oauthState});
    toast('Pinterest connected.');
    history.replaceState({},'','/'+(result?.project_id?`project/${result.project_id}`:''));
    if(result?.project_id){await openProject(result.project_id,false);return true}
  }catch(error){
    toast(`Pinterest connection failed: ${error.message}`,'bad');
    history.replaceState({},'','/');
  }
  return false;
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
  if(await handlePinterestCallback())return;
  const routed=routeProjectId();
  if(routed)return openProject(routed,false);
  return showProjects();
}

void boot();
