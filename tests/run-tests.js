import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {bulkPrompt,makeSlideZip,makeZip,parseJson,pretty,readiness,safeFilename,slidePrompt,slug} from '../src/prompting.js';
import {parseStorySets} from '../src/parser.js';

const fileAsset=(id,filename,type,content)=>({id,filename,type,size:content.length,file:new Blob([content],{type})});
const main=fileAsset('main-1','MP-41.jpg','image/jpeg',new Uint8Array([255,216,255,224,1,2,3,4]));
const ref=fileAsset('ref-1','story-ref.png','image/png',new Uint8Array([137,80,78,71,13,10,26,10,5,6]));
const pdf=fileAsset('ref-pdf','reference-layout.pdf','application/pdf','%PDF-1.4\nLadyTin');
const video=fileAsset('main-video','tina-video.mov','video/quicktime',new Uint8Array([0,0,0,20,102,116,121,112,113,116,32,32]));

const slide=(i,m=main,r=ref)=>({id:`s${i}`,slide_number:i+1,copy:`Copy ${i+1}`,overlay_text:`Copy ${i+1}`,cta:i===1?'Explore.':'',interaction:'',direction:'Use restrained editorial spacing.',art:'Use restrained editorial spacing.',role:i===0?'Opening':'Resolution / CTA',main:m,reference:r,no_text_overlay:false,caption_cc:false,content_description:'',internal_note:''});
const set={id:'set-1',title:'The Journey of a Garment',overallDirection:'Soft, tactile and intimate.'};
const slides=[slide(0),slide(1,video,pdf)];

assert.equal(slug(set.title),'the-journey-of-a-garment');
assert.equal(safeFilename(' bad/name:final.jpg '),'bad-name-final.jpg');
assert.equal(safeFilename('.hidden'),'hidden');
assert.equal(parseJson(pretty(slidePrompt(slides[0],0,slides,set,null))).ok,true);
assert.equal(parseJson(pretty(bulkPrompt(slides,set,null))).ok,true);
assert.equal(readiness(slides,set,null).every(r=>r.ready),true);

const singleBlob=await makeSlideZip(slides[0],0,slides,set,null);
assert.ok(singleBlob.size>0);
const singleZip=await JSZip.loadAsync(await singleBlob.arrayBuffer());
const singleRoot='LadyTin-the-journey-of-a-garment-slide-01/';
const requiredSingle=[
  `${singleRoot}slide-01-prompt.json`,
  `${singleRoot}main-asset-MP-41.jpg`,
  `${singleRoot}selected-reference-story-ref.png`,
  `${singleRoot}manifest.json`
];
for(const name of requiredSingle){
  assert.ok(singleZip.file(name),`${name} must exist`);
  const bytes=await singleZip.file(name).async('uint8array');
  assert.ok(bytes.length>0,`${name} must be non-zero`);
}
const prompt=JSON.parse(await singleZip.file(`${singleRoot}slide-01-prompt.json`).async('string'));
const manifest=JSON.parse(await singleZip.file(`${singleRoot}manifest.json`).async('string'));
assert.equal(prompt.attachments.main_source_asset.filename,'MP-41.jpg');
assert.equal(prompt.attachments.selected_design_reference.filename,'story-ref.png');
assert.equal(manifest.files.main_asset,'main-asset-MP-41.jpg');
assert.equal(manifest.files.selected_reference,'selected-reference-story-ref.png');
for(const path of Object.values(manifest.files))assert.ok(singleZip.file(singleRoot+path));
const extractedMain=await singleZip.file(`${singleRoot}main-asset-MP-41.jpg`).async('uint8array');
assert.deepEqual([...extractedMain],[255,216,255,224,1,2,3,4]);
assert.equal(new TextDecoder().decode(extractedMain).startsWith('blob:'),false);

const bulkBlob=await makeZip(slides,set,null,false);
assert.ok(bulkBlob.size>0);
const bulkZip=await JSZip.loadAsync(await bulkBlob.arrayBuffer());
const bulkRoot='LadyTin-the-journey-of-a-garment-bulk-generation-package/';
const requiredBulk=[
  `${bulkRoot}bulk-story-set-prompt.json`,
  `${bulkRoot}manifest.json`,
  `${bulkRoot}README.txt`,
  `${bulkRoot}slide-prompts/slide-01-prompt.json`,
  `${bulkRoot}slide-prompts/slide-02-prompt.json`,
  `${bulkRoot}main-assets/slide-01-MP-41.jpg`,
  `${bulkRoot}main-assets/slide-02-tina-video.mov`,
  `${bulkRoot}selected-references/slide-01-story-ref.png`,
  `${bulkRoot}selected-references/slide-02-reference-layout.pdf`
];
for(const name of requiredBulk){
  assert.ok(bulkZip.file(name),`${name} must exist`);
  assert.ok((await bulkZip.file(name).async('uint8array')).length>0,`${name} must be non-zero`);
}
JSON.parse(await bulkZip.file(`${bulkRoot}bulk-story-set-prompt.json`).async('string'));
const bulkManifest=JSON.parse(await bulkZip.file(`${bulkRoot}manifest.json`).async('string'));
for(const row of bulkManifest.slides){
  assert.ok(bulkZip.file(bulkRoot+row.prompt_file));
  assert.ok(bulkZip.file(bulkRoot+row.main_asset_file));
  assert.ok(bulkZip.file(bulkRoot+row.reference_file));
}

const metadataOnly={...main,file:undefined};
const unavailable=[slide(0,metadataOnly,ref)];
assert.equal(readiness(unavailable,set,null)[0].ready,false);
await assert.rejects(()=>makeSlideZip(unavailable[0],0,unavailable,set,null),/no longer available in this browser session/);
await assert.rejects(()=>makeSlideZip({...slide(0),reference:null},0,[{...slide(0),reference:null}],set,null),/Assign a main asset and design reference/);

const parsed=parseStorySets('SET 1 — परीक्षण\n\nSlide 1 — यह बिल्कुल वैसा ही रहे।\n(CTA: देखें।)\n\nSlide 2 — Tina talking video\nDirection: No text overlay but caption CC');
assert.equal(parsed.sets.length,1);
assert.equal(parsed.sets[0].slides.length,2);
assert.equal(parsed.sets[0].slides[0].overlay_text,'यह बिल्कुल वैसा ही रहे।');
assert.equal(parsed.sets[0].slides[0].cta,'देखें।');
assert.equal(parsed.sets[0].slides[1].no_text_overlay,true);
assert.equal(parsed.sets[0].slides[1].caption_cc,true);

console.log('JSZip integrity, binary attachment, parser and JSON tests passed');
