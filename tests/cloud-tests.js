import assert from'node:assert/strict';
import JSZip from'jszip';
import{storagePath,rowToAsset,assetToRow,rowToSlide,slideToRow,rowToStorySet,storySetToRow,rowToProject,rowToPin,pinToRow,hydrateProject,serialiseProject,applyRealtimeEvent,shouldApplyEvent,revisionKey,migrationPlan}from'../src/db.js';
import{ORIGINAL_TYPOGRAPHY_GUIDANCE,PINTEREST_BOARD_URL,PINTEREST_TYPOGRAPHY_GUIDANCE,parseBoardSnapshot}from'../src/pinterest.js';
import{bulkPrompt,makeSlideZip,makeZip,pretty,parseJson,readiness,safeFilename,slidePrompt}from'../src/prompting.js';
import{buildPresencePayload,flattenPresenceState,getPresenceClientId,makePresenceKey}from'../src/presence.js';
import{inviteTokenFromPath,normaliseInitialRoute}from'../src/route-bootstrap.js';

const loadZip=async blob=>JSZip.loadAsync(await blob.arrayBuffer());
const file=(name,type,bytes=[1,2,3])=>({id:name,filename:name,type,file:new Blob([new Uint8Array(bytes)],{type})});

const path=storagePath('p1','s1','a1','My Photo:final?.jpg');
assert.equal(path,'projects/p1/story-sets/s1/assets/a1/My Photo-final-.jpg');
assert.equal(safeFilename('../../etc/passwd'),'-..-etc-passwd');
const assetRow={id:'a1',project_id:'p1',story_set_id:'s1',uploaded_by:'u1',asset_type:'main',original_filename:'MP-41.jpg',mime_type:'image/jpeg',storage_path:path,byte_size:8,created_at:'2026-07-19'};
const appAsset=rowToAsset(assetRow);
assert.equal(appAsset.filename,'MP-41.jpg');
assert.equal(appAsset.type,'image/jpeg');
assert.equal(appAsset.storage_path,path);
const backRow=assetToRow(appAsset,{projectId:'p1',storySetId:'s1',uploadedBy:'u1'});
assert.equal(backRow.original_filename,'MP-41.jpg');
assert.equal(backRow.mime_type,'image/jpeg');
assert.equal(backRow.byte_size,8);

const slideRow={id:'sl1',story_set_id:'s1',slide_number:2,role:'Development',overlay_text:'यह बिल्कुल वैसा ही रहे।',cta:'देखें।',interaction:'Poll',direction:'Soft light',content_description:'Tina video',internal_note:'note',no_text_overlay:false,caption_cc:true,main_asset_id:'a1',reference_asset_id:null,reference_mode:'pinterest_selected',pinterest_pin_id:'pin9',pinterest_match_score:'88',pinterest_match_reason:'match',reference_locked:true,revision:'4',updated_at:'t',updated_by:'u2'};
const appSlide=rowToSlide(slideRow,{a1:appAsset});
assert.equal(appSlide.copy,'यह बिल्कुल वैसा ही रहे।');
assert.equal(appSlide.main.id,'a1');
assert.equal(appSlide.pinterestMatchScore,88);
assert.equal(appSlide.revision,4);
assert.equal(appSlide.referenceLocked,true);
const slideBack=slideToRow(appSlide,'s1');
assert.equal(slideBack.overlay_text,'यह बिल्कुल वैसा ही रहे।');
assert.equal(slideBack.main_asset_id,'a1');
assert.equal(slideBack.reference_mode,'pinterest_selected');
assert.equal(slideBack.pinterest_pin_id,'pin9');

const setRow={id:'s1',project_id:'p1',title:'Journey',raw_story_set_copy:'raw',parse_status:'confirmed',parse_warnings:['w'],overall_direction:'soft',sort_order:1,revision:2,updated_at:'t'};
const appSet=rowToStorySet(setRow);
assert.equal(appSet.title,'Journey');
assert.equal(appSet.rawStorySetCopy,'raw');
assert.equal(appSet.overallDirection,'soft');
const setBack=storySetToRow(appSet,'p1');
assert.equal(setBack.raw_story_set_copy,'raw');
assert.equal(setBack.overall_direction,'soft');
assert.equal(setBack.sort_order,1);
assert.equal(rowToProject({id:'p1',title:'Project',owner_id:'u1',revision:2}).ownerId,'u1');

const pinRow={pinterest_pin_id:'77',board_id:'b1',pin_url:'https://www.pinterest.com/pin/77/',title:'Quiet editorial',description:'minimal negative space serif',alt_text:'',visual_tags:{},design_analysis:{},analysis_hash:''};
const appPin=rowToPin(pinRow);
assert.equal(appPin.id,'77');
assert.ok(Object.values(appPin.visual_tags).flat().length);
assert.equal(appPin.design_analysis.typography_translation,PINTEREST_TYPOGRAPHY_GUIDANCE);
assert.equal(pinToRow(appPin,'p1').project_id,'p1');

const hydrated=hydrateProject({project:{id:'p1',title:'Project',owner_id:'u1',revision:1},storySets:[setRow,{...setRow,id:'s2',title:'Second',sort_order:2}],slides:[slideRow,{...slideRow,id:'sl2',slide_number:1}],assets:[assetRow,{...assetRow,id:'a2',asset_type:'reference',storage_path:path+'2'},{...assetRow,id:'a3',asset_type:'logo',storage_path:path+'3'}],pins:[pinRow],connection:null});
assert.equal(hydrated.storySets.length,2);
assert.equal(hydrated.storySets[0].slides.length,2);
assert.equal(hydrated.storySets[0].slides[0].id,'sl2');
assert.equal(hydrated.storySets[0].mainAssets.length,1);
assert.equal(hydrated.storySets[0].references.length,1);
assert.equal(hydrated.storySets[0].logo.id,'a3');
assert.equal(hydrated.storySets[0].pinterestPins.length,1);
const serialised=serialiseProject(hydrated);
assert.equal(serialised.storySets.length,2);
assert.equal(serialised.storySets[0].slides[0].overlay_text,'यह बिल्कुल वैसा ही रहे।');

const seen=new Map([[revisionKey('slides','sl1'),5]]);
assert.equal(shouldApplyEvent(seen,'slides',{id:'sl1',revision:5}),false);
assert.equal(shouldApplyEvent(seen,'slides',{id:'sl1',revision:6}),true);
let realtime={project:hydrated.project,storySets:hydrated.storySets};
realtime=applyRealtimeEvent(realtime,{table:'slides',type:'UPDATE',row:{...slideRow,overlay_text:'Updated by Tina',revision:9}},{a1:appAsset});
assert.equal(realtime.storySets[0].slides.find(slide=>slide.id==='sl1').copy,'Updated by Tina');
realtime=applyRealtimeEvent(realtime,{table:'slides',type:'INSERT',row:{...slideRow,id:'sl3',slide_number:3,overlay_text:'New slide'}},{});
assert.equal(realtime.storySets[0].slides.length,3);
realtime=applyRealtimeEvent(realtime,{table:'slides',type:'DELETE',row:{},old:{id:'sl3',story_set_id:'s1'}});
assert.equal(realtime.storySets[0].slides.length,2);
assert.equal(applyRealtimeEvent(realtime,{table:'projects',type:'DELETE',old:{id:'p1'},row:{}}).deleted,true);

const makeStorage=()=>{const map=new Map();return{getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)}};
const storeA=makeStorage(),storeB=makeStorage();
const clientA=getPresenceClientId(storeA,()=> 'client-a');
const clientB=getPresenceClientId(storeB,()=> 'client-b');
assert.equal(getPresenceClientId(storeA,()=> 'other'),clientA);
assert.notEqual(clientA,clientB);
assert.notEqual(makePresenceKey('shared-user',clientA),makePresenceKey('shared-user',clientB));
const flat=flattenPresenceState({[makePresenceKey('shared-user',clientA)]:[{user_id:'shared-user',client_id:clientA,name:'Veronica',context:'Slide 01'}],[makePresenceKey('shared-user',clientB)]:[{user_id:'shared-user',client_id:clientB,name:'Tina',context:'Assets & References'}]});
assert.equal(flat.length,2);
assert.deepEqual(new Set(flat.map(entry=>entry.context)),new Set(['Slide 01','Assets & References']));
const tracked=buildPresencePayload({user_id:'u1',activity:'viewing'},{activity:'editing',context:'Slide 02'});
assert.equal(tracked.activity,'editing');
assert.ok(tracked.last_active);

assert.equal(inviteTokenFromPath('/invite/token-123'),'token-123');
assert.equal(inviteTokenFromPath('/project/123'),'');
let replaced='';
const fakeWindow={location:{pathname:'/invite/a%20b',href:'https://example.test/invite/a%20b?x=1'},history:{replaceState:(_state,_title,url)=>{replaced=url}}};
assert.equal(normaliseInitialRoute(fakeWindow),'a b');
assert.match(replaced,/^\/\?x=1&invite=a\+b$|^\/\?invite=a\+b&x=1$/);

assert.equal(migrationPlan(null).ok,false);
const plan=migrationPlan({storySets:[{title:'Journey',rawStorySetCopy:'raw',overallDirection:'soft',slides:[{copy:'Exact copy.',role:'Opening',referenceMode:'manual_upload',main:{id:'m1'},reference:{id:'r1'}}],mainAssets:[{id:'m1',filename:'m.jpg',type:'image/jpeg'}],references:[{id:'r1',filename:'r.pdf',type:'application/pdf'}]}]});
assert.equal(plan.ok,true);
assert.equal(plan.sets[0].slides[0].overlay_text,'Exact copy.');
assert.equal(plan.sets[0].slides[0].reference_mode,'manual_upload');
assert.equal(plan.assetWarnings.length,2);

const pins=parseBoardSnapshot(JSON.stringify({items:[{id:'1',link:'https://www.pinterest.com/pin/1/',title:'Quiet editorial serif layout',description:'minimal negative space ivory'}]}));
const set={id:'set-1',title:'Editorial Set',overallDirection:'',pinterestBoardUrl:PINTEREST_BOARD_URL,pinterestPins:pins,pinterestConnected:true,slides:[{copy:'Opening copy.',role:'Opening',main:file('a.jpg','image/jpeg'),referenceMode:'pinterest_selected',pinterestPinId:'1'},{copy:'Manual copy.',role:'Development',main:file('b.png','image/png'),referenceMode:'manual_upload',reference:file('r.pdf','application/pdf')},{copy:'Editorial copy.',role:'Resolution / CTA',main:file('c.webp','image/webp'),referenceMode:'editorial_direction_only'}]};
for(const[index,slide]of set.slides.entries()){
  const prompt=slidePrompt(slide,index,set.slides,set,null);
  assert.equal(parseJson(pretty(prompt)).ok,true);
  assert.equal(prompt.exact_copy.overlay_text,slide.copy);
  assert.ok(prompt.typography.behaviour);
}
assert.equal(slidePrompt(set.slides[0],0,set.slides,set,null).typography.behaviour,PINTEREST_TYPOGRAPHY_GUIDANCE);
assert.equal(slidePrompt(set.slides[2],2,set.slides,set,null).typography.behaviour,ORIGINAL_TYPOGRAPHY_GUIDANCE);
assert.ok(bulkPrompt(set.slides,set,null).slides.every(slide=>slide.typography.behaviour));
assert.ok(readiness(set.slides,set,null).every(row=>row.ready));

const slideZip=await loadZip(await makeSlideZip(set.slides[0],0,set.slides,set,null));
const slideNames=Object.keys(slideZip.files);
assert.ok(!slideNames.some(name=>/\.(otf|ttf|woff2?)$/i.test(name)));
const pinMeta=JSON.parse(await slideZip.file(slideNames.find(name=>name.endsWith('pinterest-reference.json'))).async('string'));
assert.equal(pinMeta.typography_guidance,PINTEREST_TYPOGRAPHY_GUIDANCE);
const bulkNames=Object.keys((await loadZip(await makeZip(set.slides,set,null,false))).files);
assert.ok(!bulkNames.some(name=>/\.(otf|ttf|woff2?)$/i.test(name)));

const cloudOnly={...set.slides[1],main:{id:'cloud-main',filename:'cloud.jpg',type:'image/jpeg',storage_path:'projects/p/story-sets/s/assets/x/cloud.jpg'}};
const remoteSet={...set,slides:[cloudOnly]};
assert.equal(readiness(remoteSet.slides,remoteSet,null)[0].main,true);
const remoteZip=await loadZip(await makeSlideZip(cloudOnly,0,remoteSet.slides,remoteSet,null,async()=>new Uint8Array([9,9,9,9]).buffer));
const remoteMain=Object.keys(remoteZip.files).find(name=>name.includes('main-asset-cloud.jpg'));
assert.deepEqual([...(await remoteZip.file(remoteMain).async('uint8array'))],[9,9,9,9]);
await assert.rejects(()=>makeSlideZip(cloudOnly,0,remoteSet.slides,remoteSet,null,async()=>new ArrayBuffer(0)),/empty/);

console.log('Cloud mapping, shared-editor realtime, Presence, routing, migration, typography and remote ZIP tests passed');
