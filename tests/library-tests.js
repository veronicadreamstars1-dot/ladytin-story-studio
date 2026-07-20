import assert from'node:assert/strict';
import JSZip from'jszip';
const loadZip=async blob=>JSZip.loadAsync(await blob.arrayBuffer());
import{REFERENCE_MODES,REFERENCE_TYPOGRAPHY_GUIDANCE,applyReferencePlan,buildReferencePlan,editorialDirectionForSlide,hashString,inferVisualTags,recommendReferencesForSlide,resolveReferenceStrategy,scoreReferenceForSlide}from'../src/library.js';
import{bulkPrompt,makeSlideZip,makeZip,parseJson,pretty,readiness,slidePrompt}from'../src/prompting.js';
import{classifyDriveFile,driveSetupRequirements,mergeDriveSync,normaliseDriveFile}from'../src/google-drive.js';

const file=(name,type,bytes=[1,2,3])=>({id:name,filename:name,title:name,type,file:new Blob([new Uint8Array(bytes)],{type})});
const refs=[
  {...file('quiet-layout.png','image/png'),id:'ref-1',library_type:'reference',description:'minimal negative space serif editorial ivory paper texture opening'},
  {...file('craft-detail.pdf','application/pdf'),id:'ref-2',library_type:'reference',description:'fabric texture close-up tactile crafted process detail warm neutral'},
  {...file('cta-reveal.webp','image/webp'),id:'ref-3',library_type:'reference',description:'full look reveal aspirational clean grotesk controlled accent colour CTA'}
].map(item=>({...item,visual_tags:inferVisualTags(item)}));

const set={id:'set-1',title:'Journey of a Garment',overallDirection:'soft tactile intimate',references:refs,slides:[{copy:'It starts on a wall covered in paper.',role:'Opening',main:file('a.jpg','image/jpeg'),referenceMode:'editorial_direction_only'},{copy:'Hands stitch the smallest details.',role:'Development',main:file('b.mov','video/quicktime'),referenceMode:'editorial_direction_only'},{copy:'Discover the complete collection.',cta:'Explore Laya.',role:'Resolution / CTA',main:file('c.webp','image/webp'),referenceMode:'editorial_direction_only'}]};

assert.deepEqual(REFERENCE_MODES,['library_reference','manual_upload','editorial_direction_only']);
assert.equal(hashString('same'),hashString('same'));
assert.ok(scoreReferenceForSlide(refs[0],set.slides[0],set,{})>=45);
assert.ok(scoreReferenceForSlide(refs[1],set.slides[1],set,{})>=45);
assert.ok(recommendReferencesForSlide(refs,set.slides[0],set).length>0);

const plan=buildReferencePlan(set,refs);
assert.equal(plan.slides.length,3);
applyReferencePlan(set,plan);
assert.ok(set.slides.every(s=>['library_reference','editorial_direction_only'].includes(s.referenceMode)));
const locked=set.slides[0];
locked.referenceLocked=true;
locked.referenceMode='library_reference';
locked.reference=refs[1];
locked.referenceId=refs[1].id;
applyReferencePlan(set,buildReferencePlan(set,refs));
assert.equal(locked.reference.id,'ref-2');

const manual={...set.slides[1],referenceMode:'manual_upload',reference:file('ref.pdf','application/pdf')};
let strategy=resolveReferenceStrategy(manual,1,set.slides,set);
assert.equal(strategy.mode,'manual_upload');
assert.equal(strategy.reference_filename,'ref.pdf');
const editorial={...set.slides[0],reference:null,referenceMode:'editorial_direction_only'};
strategy=resolveReferenceStrategy(editorial,0,set.slides,set);
assert.equal(strategy.source,'generated_editorial_direction');
assert.ok(strategy.original_editorial_direction.concept_title);
assert.ok(editorialDirectionForSlide(editorial,0,3,set).avoid.includes('generic Canva layout'));

const selectedSet={...set,slides:[{copy:'A quiet opening.',role:'Opening',main:file('main.png','image/png'),referenceMode:'library_reference',reference:refs[0]}]};
assert.equal(readiness(selectedSet.slides,selectedSet,null)[0].ready,true);
const selectedJson=slidePrompt(selectedSet.slides[0],0,selectedSet.slides,selectedSet,null);
assert.equal(selectedJson.reference_strategy.mode,'library_reference');
assert.equal(parseJson(pretty(selectedJson)).ok,true);
assert.match(selectedJson.creative_rules.join(' '),/Do not reproduce a reference/);
assert.equal(selectedJson.typography.behaviour,REFERENCE_TYPOGRAPHY_GUIDANCE);

const slideZip=await makeSlideZip(selectedSet.slides[0],0,selectedSet.slides,selectedSet,null);
const loaded=await loadZip(slideZip);
const names=Object.keys(loaded.files);
assert.ok(names.some(x=>x.endsWith('selected-reference-quiet-layout.png')));
assert.ok(!names.some(x=>x.includes('removed-board')));
const mixedSet={...set,slides:[selectedSet.slides[0],manual,editorial]};
const mixedZip=await makeZip(mixedSet.slides,mixedSet,null,false);
const mixedNames=Object.keys((await loadZip(mixedZip)).files);
assert.ok(mixedNames.some(x=>x.includes('/selected-references/')));
assert.ok(mixedNames.some(x=>x.endsWith('/bulk-story-set-prompt.json')));
assert.equal(bulkPrompt(mixedSet.slides,mixedSet,null).slides.length,3);

const native=classifyDriveFile({name:'story doc',mimeType:'application/vnd.google-apps.document'});
assert.equal(native.supported,false);
const driveFile=normaliseDriveFile({id:'g1',name:'layout.pdf',mimeType:'application/pdf',size:'42',parents:['root'],webViewLink:'https://drive.test/file',modifiedTime:'2026-07-20T00:00:00Z'},'reference');
assert.equal(driveFile.source_type,'google_drive');
assert.equal(driveFile.sync_supported,true);
const sync=mergeDriveSync([], [driveFile], 'reference');
assert.equal(sync.summary.files_added,1);
assert.equal(driveSetupRequirements().message,'Google Drive is not configured yet.');

console.log('Shared library matching, reference modes, JSON, ZIP and Drive sync helper tests passed');
