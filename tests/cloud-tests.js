import assert from'node:assert/strict';
import JSZip from'jszip';
const loadZip=async blob=>JSZip.loadAsync(await blob.arrayBuffer());
import{authReducer,storagePath,rowToAsset,assetToRow,rowToSlide,slideToRow,rowToStorySet,storySetToRow,rowToProject,rowToPin,pinToRow,hydrateProject,serialiseProject,applyRealtimeEvent,shouldApplyEvent,revisionKey,validateInvite,migrationPlan,canEdit,isOwner}from'../src/db.js';
import{AQUALIM_PINTEREST_RULE,AQUALIM_RULE,PINTEREST_BOARD_URL,parseBoardSnapshot}from'../src/pinterest.js';
import{bulkPrompt,makeSlideZip,makeZip,pretty,parseJson,readiness,safeFilename,slidePrompt}from'../src/prompting.js';

// ---------- auth reducer ----------
let auth=authReducer(undefined,{});
assert.equal(auth.status,'loading');
auth=authReducer(auth,{type:'AUTH_SIGNED_IN',user:{id:'u1',email:'v@example.com'}});
assert.equal(auth.status,'signed_in');assert.equal(auth.user.email,'v@example.com');
auth=authReducer(auth,{type:'AUTH_ERROR',error:'nope'});
assert.equal(auth.status,'signed_in');assert.equal(auth.error,'nope');
auth=authReducer(auth,{type:'AUTH_SIGNED_OUT'});
assert.equal(auth.status,'signed_out');assert.equal(auth.user,null);
assert.equal(authReducer(undefined,{type:'AUTH_LINK_SENT'}).status,'link_sent');

// ---------- roles ----------
assert.ok(canEdit('owner')&&canEdit('editor')&&!canEdit('viewer'));
assert.ok(isOwner('owner')&&!isOwner('editor'));

// ---------- storage paths ----------
const path=storagePath('p1','s1','a1','My Photo:final?.jpg');
assert.equal(path,'projects/p1/story-sets/s1/assets/a1/My Photo-final-.jpg');
assert.equal(safeFilename('../../etc/passwd'),'..-..-etc-passwd'.replace(/^\.+/,''));

// ---------- mapping round trips ----------
const assetRow={id:'a1',project_id:'p1',story_set_id:'s1',uploaded_by:'u1',asset_type:'main',original_filename:'MP-41.jpg',mime_type:'image/jpeg',storage_path:path,byte_size:8,created_at:'2026-07-19'};
const appAsset=rowToAsset(assetRow);
assert.equal(appAsset.filename,'MP-41.jpg');assert.equal(appAsset.type,'image/jpeg');assert.equal(appAsset.storage_path,path);
const backRow=assetToRow(appAsset,{projectId:'p1',storySetId:'s1',uploadedBy:'u1'});
assert.equal(backRow.original_filename,'MP-41.jpg');assert.equal(backRow.mime_type,'image/jpeg');assert.equal(backRow.byte_size,8);

const slideRow={id:'sl1',story_set_id:'s1',slide_number:2,role:'Development',overlay_text:'यह बिल्कुल वैसा ही रहे।',cta:'देखें।',interaction:'Poll',direction:'Soft light',content_description:'Tina video',internal_note:'note',no_text_overlay:false,caption_cc:true,main_asset_id:'a1',reference_asset_id:null,reference_mode:'pinterest_selected',pinterest_pin_id:'pin9',pinterest_match_score:'88',pinterest_match_reason:'match',reference_locked:true,revision:'4',updated_at:'t',updated_by:'u2'};
const appSlide=rowToSlide(slideRow,{a1:appAsset});
assert.equal(appSlide.copy,'यह बिल्कुल वैसा ही रहे।');
assert.equal(appSlide.overlay_text,'यह बिल्कुल वैसा ही रहे।');
assert.equal(appSlide.art,'Soft light');
assert.equal(appSlide.main.id,'a1');
assert.equal(appSlide.pinterestMatchScore,88);
assert.equal(appSlide.revision,4);
assert.equal(appSlide.referenceLocked,true);
const slideBack=slideToRow(appSlide,'s1');
assert.equal(slideBack.overlay_text,'यह बिल्कुल वैसा ही रहे।');
assert.equal(slideBack.main_asset_id,'a1');
assert.equal(slideBack.reference_mode,'pinterest_selected');
assert.equal(slideBack.pinterest_pin_id,'pin9');
assert.equal(slideBack.reference_locked,true);

const setRow={id:'s1',project_id:'p1',title:'Journey',raw_story_set_copy:'raw',parse_status:'confirmed',parse_warnings:['w'],overall_direction:'soft',sort_order:1,revision:2,updated_at:'t'};
const appSet=rowToStorySet(setRow);
assert.equal(appSet.title,'Journey');assert.equal(appSet.rawStorySetCopy,'raw');assert.equal(appSet.overallDirection,'soft');assert.equal(appSet.revision,2);
const setBack=storySetToRow(appSet,'p1');
assert.equal(setBack.raw_story_set_copy,'raw');assert.equal(setBack.overall_direction,'soft');assert.equal(setBack.sort_order,1);

// ---------- pins ----------
const pinRow={pinterest_pin_id:'77',board_id:'b1',pin_url:'https://www.pinterest.com/pin/77/',title:'Quiet editorial',description:'minimal negative space serif',alt_text:'',visual_tags:{},design_analysis:{},analysis_hash:''};
const appPin=rowToPin(pinRow);
assert.equal(appPin.id,'77');
assert.ok(Object.values(appPin.visual_tags).flat().length,'server-synced pins get deterministic tags');
assert.equal(appPin.design_analysis.typography_translation,AQUALIM_PINTEREST_RULE);
const pinBack=pinToRow(appPin,'p1');
assert.equal(pinBack.pinterest_pin_id,'77');assert.equal(pinBack.project_id,'p1');

// ---------- hydration & serialisation ----------
const hydrated=hydrateProject({
  project:{id:'p1',title:'Project',owner_id:'u1',revision:1},
  storySets:[setRow,{...setRow,id:'s2',title:'Second',sort_order:2}],
  slides:[slideRow,{...slideRow,id:'sl2',slide_number:1}],
  assets:[assetRow,{...assetRow,id:'a2',asset_type:'reference',storage_path:path+'2'},{...assetRow,id:'a3',asset_type:'logo',storage_path:path+'3'}],
  pins:[pinRow],
  connection:null,
});
assert.equal(hydrated.project.title,'Project');
assert.equal(hydrated.storySets.length,2);
assert.equal(hydrated.storySets[0].slides.length,2);
assert.equal(hydrated.storySets[0].slides[0].id,'sl2','slides sorted by slide_number');
assert.equal(hydrated.storySets[0].mainAssets.length,1);
assert.equal(hydrated.storySets[0].references.length,1);
assert.equal(hydrated.storySets[0].logo.id,'a3');
assert.equal(hydrated.storySets[0].pinterestPins.length,1);
assert.equal(hydrated.storySets[0].pinterestSnapshotImported,true);
assert.equal(hydrated.storySets[0].pinterestConnected,false);
const serialised=serialiseProject(hydrated);
assert.equal(serialised.storySets.length,2);
assert.equal(serialised.storySets[0].slides[0].slide_number,1);
assert.equal(serialised.storySets[0].slides[0].overlay_text,'यह बिल्कुल वैसा ही रहे।');

// ---------- realtime reducer & echo prevention ----------
const seen=new Map();
seen.set(revisionKey('slides','sl1'),5);
assert.equal(shouldApplyEvent(seen,'slides',{id:'sl1',revision:5}),false,'own write echo skipped');
assert.equal(shouldApplyEvent(seen,'slides',{id:'sl1',revision:6}),true,'newer remote write applies');
assert.equal(shouldApplyEvent(seen,'slides',{id:'other',revision:1}),true);

let rtState={project:hydrated.project,storySets:hydrated.storySets};
rtState=applyRealtimeEvent(rtState,{table:'slides',type:'UPDATE',row:{...slideRow,overlay_text:'Updated by Tina',revision:9}},{a1:appAsset});
assert.equal(rtState.storySets[0].slides.find(s=>s.id==='sl1').copy,'Updated by Tina');
assert.equal(rtState.storySets[0].slides.find(s=>s.id==='sl1').revision,9);
rtState=applyRealtimeEvent(rtState,{table:'slides',type:'INSERT',row:{...slideRow,id:'sl3',slide_number:3,overlay_text:'New slide'}},{});
assert.equal(rtState.storySets[0].slides.length,3);
rtState=applyRealtimeEvent(rtState,{table:'slides',type:'DELETE',row:{},old:{id:'sl3',story_set_id:'s1'}});
assert.equal(rtState.storySets[0].slides.length,2);
rtState=applyRealtimeEvent(rtState,{table:'story_sets',type:'UPDATE',row:{...setRow,title:'Renamed',revision:7}});
assert.equal(rtState.storySets[0].title,'Renamed');
rtState=applyRealtimeEvent(rtState,{table:'story_sets',type:'INSERT',row:{...setRow,id:'s9',title:'Third',sort_order:9}});
assert.equal(rtState.storySets.length,3);
rtState=applyRealtimeEvent(rtState,{table:'assets',type:'INSERT',row:{...assetRow,id:'a9',original_filename:'new.png',storage_path:path+'9'}});
assert.ok(rtState.storySets[0].mainAssets.some(a=>a.id==='a9'));
rtState=applyRealtimeEvent(rtState,{table:'pinterest_pins',type:'INSERT',row:{...pinRow,pinterest_pin_id:'88'}});
assert.ok(rtState.storySets[0].pinterestPins.some(p=>p.id==='88'));
const deleted=applyRealtimeEvent(rtState,{table:'projects',type:'DELETE',old:{id:'p1'},row:{}});
assert.equal(deleted.deleted,true);

// ---------- invite validation ----------
const future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-1000).toISOString();
assert.equal(validateInvite(null).ok,false);
assert.equal(validateInvite({email:'a@b.c',role:'editor',expires_at:future,accepted_at:'2026-01-01'},{email:'a@b.c'}).ok,false,'reuse blocked');
assert.equal(validateInvite({email:'a@b.c',role:'editor',expires_at:past},{email:'a@b.c'}).ok,false,'expired blocked');
assert.equal(validateInvite({email:'a@b.c',role:'editor',expires_at:future},{email:'x@y.z'}).ok,false,'wrong email blocked');
assert.equal(validateInvite({email:'a@b.c',role:'owner',expires_at:future},{email:'a@b.c'}).ok,false,'invalid role blocked');
assert.equal(validateInvite({email:'A@B.C',role:'viewer',expires_at:future},{email:'a@b.c'}).ok,true);

// ---------- localStorage migration plan ----------
assert.equal(migrationPlan(null).ok,false);
assert.equal(migrationPlan({}).ok,false);
const plan=migrationPlan({storySets:[{title:'Journey',rawStorySetCopy:'raw',overallDirection:'soft',slides:[{copy:'Exact copy.',role:'Opening',referenceMode:'manual_upload',main:{id:'m1'},reference:{id:'r1'}}],mainAssets:[{id:'m1',filename:'m.jpg',type:'image/jpeg'}],references:[{id:'r1',filename:'r.pdf',type:'application/pdf'}]}]});
assert.equal(plan.ok,true);
assert.equal(plan.sets[0].slides[0].overlay_text,'Exact copy.');
assert.equal(plan.sets[0].slides[0].reference_mode,'manual_upload');
assert.equal(plan.sets[0].slides[0].localMainId,'m1');
assert.equal(plan.assetWarnings.length,2,'metadata-only assets are flagged');
// legacy single-project shape
const legacy=migrationPlan({title:'Old',slides:[{copy:'Legacy'}],copyDraft:'draft'});
assert.equal(legacy.ok,true);assert.equal(legacy.sets[0].slides[0].overlay_text,'Legacy');

// ---------- Aqualim rules in every generated surface ----------
const file=(name,type,bytes=[1,2,3])=>({id:name,filename:name,type,file:new Blob([new Uint8Array(bytes)],{type})});
const pins=parseBoardSnapshot(JSON.stringify({items:[{id:'1',link:'https://www.pinterest.com/pin/1/',title:'Quiet editorial serif layout',description:'minimal negative space ivory'}]}));
const aqSet={id:'set-1',title:'Aqualim Set',overallDirection:'',pinterestBoardUrl:PINTEREST_BOARD_URL,pinterestPins:pins,pinterestConnected:true,slides:[
  {copy:'Opening copy.',role:'Opening',main:file('a.jpg','image/jpeg'),referenceMode:'pinterest_selected',pinterestPinId:'1'},
  {copy:'Manual copy.',role:'Development',main:file('b.png','image/png'),referenceMode:'manual_upload',reference:file('r.pdf','application/pdf')},
  {copy:'Editorial copy.',role:'Resolution / CTA',main:file('c.webp','image/webp'),referenceMode:'editorial_direction_only'},
]};
for(const[i,s]of aqSet.slides.entries()){
  const p=slidePrompt(s,i,aqSet.slides,aqSet,null);
  assert.equal(parseJson(pretty(p)).ok,true);
  assert.ok(p.creative_rules.includes(AQUALIM_RULE),'creative rules carry the Aqualim-only rule');
  assert.equal(p.typography.typeface,'Aqualim Regular');
  assert.equal(p.typography.aqualim_only_rule,AQUALIM_RULE);
  assert.equal(p.story_set_consistency.use_aqualim_regular_as_only_typeface,true);
  assert.equal(p.exact_copy.overlay_text,aqSet.slides[i].copy,'exact copy preserved');
  const text=pretty(p);
  assert.ok(!/Geist Mono|IBM Plex|Google Fonts|Helvetica|Arial|Times New Roman/i.test(text),'no competing font instructions');
}
const pinPrompt=slidePrompt(aqSet.slides[0],0,aqSet.slides,aqSet,null);
assert.equal(pinPrompt.typography.pinterest_typography_rule,AQUALIM_PINTEREST_RULE);
assert.equal(pinPrompt.reference_strategy.design_analysis.typography_translation,AQUALIM_PINTEREST_RULE);
const edPrompt=slidePrompt(aqSet.slides[2],2,aqSet.slides,aqSet,null);
assert.match(edPrompt.reference_strategy.original_editorial_direction.typography,/Aqualim Regular/);
const bulk=bulkPrompt(aqSet.slides,aqSet,null);
assert.equal(bulk.typography.aqualim_only_rule,AQUALIM_RULE);
assert.equal(bulk.typography.pinterest_typography_rule,AQUALIM_PINTEREST_RULE);
assert.ok(bulk.slides.every(s=>s.typography.aqualim_only_rule===AQUALIM_RULE));
assert.ok(readiness(aqSet.slides,aqSet,null).every(r=>r.ready));

// ---------- ZIPs: README rules, no font binary ----------
const slideZip=await loadZip(await makeSlideZip(aqSet.slides[0],0,aqSet.slides,aqSet,null));
const slideNames=Object.keys(slideZip.files);
const slideReadme=await slideZip.file(slideNames.find(x=>x.endsWith('README.txt'))).async('string');
assert.ok(slideReadme.includes(AQUALIM_RULE));
assert.ok(slideReadme.includes(AQUALIM_PINTEREST_RULE));
assert.ok(!slideNames.some(x=>/\.(otf|ttf|woff2?)$/i.test(x)),'no font binary in slide ZIP');
const pinMetaName=slideNames.find(x=>x.endsWith('pinterest-reference.json'));
const pinMeta=JSON.parse(await slideZip.file(pinMetaName).async('string'));
assert.equal(pinMeta.typography_rule,AQUALIM_PINTEREST_RULE);
const bulkZip=await loadZip(await makeZip(aqSet.slides,aqSet,null,false));
const bulkNames=Object.keys(bulkZip.files);
const bulkReadme=await bulkZip.file(bulkNames.find(x=>x.endsWith('README.txt'))).async('string');
assert.ok(bulkReadme.includes(AQUALIM_RULE));
assert.ok(!bulkNames.some(x=>/\.(otf|ttf|woff2?)$/i.test(x)),'no font binary in bulk ZIP');

// ---------- remote binary resolver contract (via prompting remoteLoader) ----------
const cloudOnly={...aqSet.slides[1],main:{id:'cloud-main',filename:'cloud.jpg',type:'image/jpeg',storage_path:'projects/p/story-sets/s/assets/x/cloud.jpg'}};
const remoteSet={...aqSet,slides:[cloudOnly]};
assert.equal(readiness(remoteSet.slides,remoteSet,null)[0].main,true,'cloud asset metadata counts as available');
const remoteLoader=async asset=>{assert.equal(asset.storage_path,'projects/p/story-sets/s/assets/x/cloud.jpg');return new Uint8Array([9,9,9,9]).buffer};
const remoteZip=await loadZip(await makeSlideZip(cloudOnly,0,remoteSet.slides,remoteSet,null,remoteLoader));
const remoteMain=Object.keys(remoteZip.files).find(x=>x.includes('main-asset-cloud.jpg'));
const remoteBytes=await remoteZip.file(remoteMain).async('uint8array');
assert.equal(remoteBytes.length,4,'remote bytes packaged exactly');
await assert.rejects(()=>makeSlideZip(cloudOnly,0,remoteSet.slides,remoteSet,null,async()=>new ArrayBuffer(0)),/empty/);

console.log('Cloud mapping, realtime, invites, migration, Aqualim and remote ZIP tests passed');
