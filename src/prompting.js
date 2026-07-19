import JSZip from 'jszip';

export const n=i=>String(i+1).padStart(2,'0');
export const slug=s=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'untitled-story-set';
export const pretty=o=>JSON.stringify(o,null,2);
export const parseJson=s=>{try{return{ok:true,value:JSON.parse(s)}}catch(e){return{ok:false,error:e.message}}};

const creativeRules=[
  'The copy and visual must directly match.',
  "Use the selected design reference for this slide's layout and composition.",
  'Keep this slide visually consistent with the complete story set.',
  'Derive restrained graphic elements, colours and motifs from the exact outfit where appropriate.',
  'Treat every slide as one part of a continuous narrative, not as an unrelated design.',
  'Use exact uploaded logos only. Never redraw, regenerate or reinterpret a LadyTin or Laya logo.',
  'Do not invent copy, decoration or fake brand elements.'
];

const lockedPreservationRules={
  preserve_face:true,preserve_identity:true,preserve_expression:true,preserve_body:true,preserve_pose:true,
  preserve_outfit:true,preserve_garment_design:true,preserve_fabric:true,preserve_print:true,
  preserve_embroidery:true,preserve_colour:true,preserve_jewellery:true,preserve_styling:true,
  preserve_copy:true,never_redraw_logo:true
};

const consistencyRules={
  study_complete_set_before_generating:true,maintain_typography_behaviour:true,maintain_margin_system:true,
  maintain_colour_grade:true,maintain_motif_language:true,maintain_image_treatment:true,
  maintain_emotional_progression:true,use_references_only_for_slide_specific_layout_behaviour:true,
  do_not_create_unrelated_designs_for_individual_slides:true
};

function copyOf(s){return s.overlay_text??s.copy??''}
function directionOf(s){return s.direction??s.art??''}
function roleOf(s,i,count){return s.role||(i===0?'Opening':i===count-1?'Resolution / CTA':'Development')}

export function safeFilename(name,fallback='file'){
  const raw=String(name||fallback).normalize('NFC').replace(/[\\/:*?"<>\u0000-\u001f|]/g,'-').replace(/^\.+/,'').replace(/[ .]+$/g,'').trim();
  return raw||fallback;
}

export function storyArc(slides){
  const byRole=needle=>slides.filter(s=>String(s.role||'').toLowerCase().includes(needle)).map(copyOf).filter(Boolean).join(' ');
  return{
    opening:byRole('opening')||copyOf(slides[0]||{}),
    development:byRole('development'),
    resolution:byRole('resolution')||copyOf(slides.at(-1)||{}),
    cta_or_interaction:slides.map(s=>s.cta||s.interaction||'').filter(Boolean).join(' ')
  };
}

export function slidePrompt(s,i,slides,set,logo){
  const ref=s.reference||null,main=s.main||null;
  return{
    schema_version:'1.0',generation_mode:'single_story_slide',project:'LadyTin Story Studio',
    brand:{vertical:'LadyTin Label',collection:'Laya'},
    story_set:{id:set.id||slug(set.title),title:set.title||'',slide_number:i+1,slide_count:slides.length,role_in_arc:roleOf(s,i,slides.length),overall_set_direction:set.overallDirection||''},
    exact_copy:{overlay_text:copyOf(s),cta:s.cta||'',interaction:s.interaction||'',no_text_overlay:!!s.no_text_overlay,caption_cc:!!s.caption_cc,preserve_exactly:true},
    attachments:{
      main_source_asset:{id:main?.id||s.assetId||'',filename:main?.filename||'',file_type:main?.type||'',required:true},
      selected_design_reference:{id:ref?.id||s.referenceId||'',filename:ref?.filename||'',file_type:ref?.type||'',required:true},
      logo_overlay:{filename:logo?.filename||'',required_when_applicable:true,instruction:'Use only the exact uploaded logo as a locked final overlay. Never redraw or regenerate it.'}
    },
    story_set_consistency:{...consistencyRules},
    slide_art_direction:{content_description:s.content_description||'',composition_instruction:'',additional_user_direction:directionOf(s),internal_production_note:s.internal_note||'',connection_to_previous_slide:i?`Continue naturally from Slide ${n(i-1)}.`:'This is the opening slide.',connection_to_next_slide:i<slides.length-1?`Lead naturally into Slide ${n(i+1)}.`:'Resolve the complete story set.'},
    creative_rules:[...creativeRules],locked_preservation_rules:{...lockedPreservationRules},
    output:{count:1,format:'PNG',aspect_ratio:'9:16',separate_image:true,no_collage:true,no_phone_mockup:true,no_extra_text:true,no_fake_logo:true}
  };
}

export function bulkPrompt(slides,set,logo){
  return{
    schema_version:'1.0',generation_mode:'bulk_story_set',project:'LadyTin Story Studio',brand:{vertical:'LadyTin Label',collection:'Laya'},
    story_set:{id:set.id||slug(set.title),title:set.title||'',slide_count:slides.length,overall_set_direction:set.overallDirection||'',output_order:'sequential'},
    story_arc:storyArc(slides),
    set_wide_consistency:{study_the_full_story_set_before_generating_slide_1:true,treat_all_slides_as_one_continuous_story:true,maintain_consistent_typography_behaviour:true,maintain_consistent_margins_and_spacing:true,maintain_one_controlled_colour_grade:true,maintain_one_restrained_motif_family:true,maintain_consistent_image_treatment:true,maintain_emotional_and_narrative_progression:true,use_different_references_only_for_slide_specific_layout_behaviour:true,do_not_create_unrelated_designs_for_individual_slides:true,overall_set_direction:set.overallDirection||''},
    generation_instruction:{study_the_complete_story_set_first:true,generate_all_slides_in_this_request:true,stop_after_first_slide:false,generate_in_slide_order:true,output_each_slide_separately:true,preserve_story_continuity:true,do_not_create_a_collage:true},
    locked_preservation_rules:{...lockedPreservationRules},creative_rules:[...creativeRules],
    slides:slides.map((s,i)=>{const ref=s.reference||null,main=s.main||null;return{slide_number:i+1,role_in_arc:roleOf(s,i,slides.length),exact_copy:{overlay_text:copyOf(s),cta:s.cta||'',interaction:s.interaction||'',no_text_overlay:!!s.no_text_overlay,caption_cc:!!s.caption_cc,preserve_exactly:true},attachments:{main_source_asset:{id:main?.id||s.assetId||'',filename:main?.filename||'',file_type:main?.type||''},selected_design_reference:{id:ref?.id||s.referenceId||'',filename:ref?.filename||'',file_type:ref?.type||''},logo_overlay:{filename:logo?.filename||''}},art_direction:{content_description:s.content_description||'',additional_user_direction:directionOf(s),internal_production_note:s.internal_note||''},output:{count:1,format:'PNG',aspect_ratio:'9:16',separate_image:true}}}),
    expected_results:{number_of_images:slides.length,file_naming:slides.map((_,i)=>`slide-${n(i)}.png`)}
  };
}

function hasBinary(asset){return !!asset?.file&&typeof asset.file.arrayBuffer==='function'}
export function readiness(slides,set,logo){
  return slides.map((s,i)=>{const missing=[],hasCopy=!!copyOf(s).trim()||!!s.no_text_overlay;if(!hasCopy)missing.push('confirmed copy or no-text-overlay');if(!s.main)missing.push('main asset');else if(!hasBinary(s.main))missing.push('main asset binary unavailable');if(!s.reference)missing.push('design reference');else if(!hasBinary(s.reference))missing.push('design reference binary unavailable');const json=parseJson(pretty(slidePrompt(s,i,slides,set,logo))).ok;return{slide:i+1,main:!!s.main&&hasBinary(s.main),reference:!!s.reference&&hasBinary(s.reference),json,ready:missing.length===0&&json,missing};});
}

async function binary(asset,label,slideNumber){
  if(!asset)throw new Error(`Slide ${slideNumber}: ${label} is not assigned.`);
  if(!hasBinary(asset))throw new Error(`Slide ${slideNumber}: the original uploaded ${label} file "${asset.filename||'unknown'}" is no longer available in this browser session. Please upload it again.`);
  const bytes=await asset.file.arrayBuffer();
  if(!bytes.byteLength)throw new Error(`Slide ${slideNumber}: ${label} file "${asset.filename||'unknown'}" is empty.`);
  return bytes;
}

function validatedJson(object,label){
  const text=JSON.stringify(object,null,2);
  try{JSON.parse(text)}catch(error){throw new Error(`${label} is invalid JSON: ${error.message}`)}
  if(text==='{}')throw new Error(`${label} is empty.`);
  return text;
}

async function generateZip(zip){
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6},mimeType:'application/zip'});
  if(!blob||!blob.size)throw new Error('ZIP generation returned an empty file.');
  const sig=new Uint8Array(await blob.slice(0,4).arrayBuffer());
  if(sig[0]!==0x50||sig[1]!==0x4b)throw new Error('ZIP signature validation failed.');
  return blob;
}

export async function makeSlideZip(s,i,slides,set,logo){
  const row=readiness([s],set,logo)[0];
  if(!s.main||!s.reference)throw new Error('Assign a main asset and design reference before downloading this slide package.');
  if(!row.json)throw new Error(`Slide ${i+1}: the JSON prompt is invalid.`);
  const sn=n(i),root=`LadyTin-${slug(set.title)}-slide-${sn}`,zip=new JSZip(),folder=zip.folder(root);
  const mainName=`main-asset-${safeFilename(s.main.filename,'main-asset')}`;
  const refName=`selected-reference-${safeFilename(s.reference.filename,'selected-reference')}`;
  const promptName=`slide-${sn}-prompt.json`;
  const promptText=validatedJson(slidePrompt(s,i,slides,set,logo),promptName);
  const mainBytes=await binary(s.main,'main asset',i+1);
  const refBytes=await binary(s.reference,'design reference',i+1);
  const manifest={schema_version:'1.0',package_type:'LadyTin_single_story_slide_generation',story_set_title:set.title||'',slide_number:i+1,files:{prompt:promptName,main_asset:mainName,selected_reference:refName},ready_for_generation:true,missing_requirements:[]};
  folder.file(promptName,promptText);
  folder.file(mainName,mainBytes,{binary:true});
  folder.file(refName,refBytes,{binary:true});
  folder.file('manifest.json',validatedJson(manifest,'manifest.json'));
  return generateZip(zip);
}

export async function makeZip(slides,set,logo,incomplete=false){
  const rows=readiness(slides,set,logo);
  if(!incomplete&&rows.some(r=>!r.ready))throw new Error('Assign a main asset and design reference for every slide before downloading the complete story-set package.');
  const root=`LadyTin-${slug(set.title)}-bulk-generation-package`,zip=new JSZip(),folder=zip.folder(root);
  folder.file('bulk-story-set-prompt.json',validatedJson(bulkPrompt(slides,set,logo),'bulk-story-set-prompt.json'));
  folder.file('README.txt','Upload bulk-story-set-prompt.json and all files from main-assets and selected-references. Study the complete set before generating. Generate every slide in order as a separate 9:16 image. Do not create a collage. Review story continuity before approval.');
  const manifest={schema_version:'1.0',package_type:'LadyTin_bulk_story_set_generation',story_set_id:set.id||slug(set.title),story_set_title:set.title,slide_count:slides.length,files:{bulk_prompt:'bulk-story-set-prompt.json',slide_prompts_directory:'slide-prompts/',main_assets_directory:'main-assets/',references_directory:'selected-references/',logos_directory:'logos/'},slides:[]};
  for(const [i,s]of slides.entries()){
    const sn=n(i),promptPath=`slide-prompts/slide-${sn}-prompt.json`;
    folder.file(promptPath,validatedJson(slidePrompt(s,i,slides,set,logo),promptPath));
    let mainPath='',refPath='';
    if(s.main){mainPath=`main-assets/slide-${sn}-${safeFilename(s.main.filename,'main-asset')}`;folder.file(mainPath,await binary(s.main,'main asset',i+1),{binary:true});}
    if(s.reference){refPath=`selected-references/slide-${sn}-${safeFilename(s.reference.filename,'selected-reference')}`;folder.file(refPath,await binary(s.reference,'design reference',i+1),{binary:true});}
    manifest.slides.push({slide_number:i+1,prompt_file:promptPath,main_asset_file:mainPath,reference_file:refPath,logo_file:logo?`logos/${safeFilename(logo.filename,'logo')}`:'',ready_for_generation:rows[i].ready,missing_requirements:rows[i].missing});
  }
  if(logo){folder.file(`logos/${safeFilename(logo.filename,'logo')}`,await binary(logo,'logo',0),{binary:true});}
  folder.file('manifest.json',validatedJson(manifest,'manifest.json'));
  return generateZip(zip);
}
