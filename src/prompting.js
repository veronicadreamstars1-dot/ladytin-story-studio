import JSZip from'jszip';
import{ORIGINAL_TYPOGRAPHY_GUIDANCE,REFERENCE_TYPOGRAPHY_GUIDANCE,resolveReferenceStrategy}from'./library.js';

export const n=i=>String(i+1).padStart(2,'0');
export const slug=s=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'untitled-story-set';
export const pretty=o=>JSON.stringify(o,null,2);
export const parseJson=s=>{try{return{ok:true,value:JSON.parse(s)}}catch(e){return{ok:false,error:e.message}}};

const creativeRules=[
  'The copy and visual must directly match and make emotional sense.',
  'Treat every slide as one part of a continuous story, not as an unrelated social-media template.',
  'Use any selected library reference only for transferable design logic: hierarchy, crop, balance, scale, negative space, rhythm, texture, typography placement, framing, tension and pacing.',
  'Do not reproduce a reference’s exact artwork, copy, branding, model, garment or proprietary graphic elements.',
  'Choose typography behaviour from the selected reference or Original Editorial Direction, then maintain one coherent set-wide system without copying an exact proprietary typeface.',
  'Keep the result nuanced, tasteful, restrained, premium, fashion-aware and editorially designed.',
  'Avoid generic Canva layouts, cluttered collages, random decorative shapes, tacky fashion graphics, excessive gold, stock-photo aesthetics and obvious AI artefacts.',
  'Derive restrained graphic elements, colours and motifs from the exact outfit where appropriate.',
  'Use exact uploaded logos only. Never redraw, regenerate or reinterpret a LadyTin or Laya logo.',
  'Do not invent copy, body copy, decoration or fake brand elements.'
];

const lockedPreservationRules={preserve_face:true,preserve_identity:true,preserve_expression:true,preserve_body:true,preserve_pose:true,preserve_outfit:true,preserve_garment_design:true,preserve_fabric:true,preserve_print:true,preserve_embroidery:true,preserve_colour:true,preserve_jewellery:true,preserve_styling:true,preserve_copy:true,never_redraw_logo:true};

const typographyBlock=strategy=>({
  source:strategy?.source==='reference_library'?'selected_reference_logic':'original_editorial_direction',
  behaviour:strategy?.source==='reference_library'?REFERENCE_TYPOGRAPHY_GUIDANCE:ORIGINAL_TYPOGRAPHY_GUIDANCE,
  set_consistency:'Use one controlled typography family or deliberately related system across the complete story set. Vary scale, placement, case, line breaks and spacing only when the narrative requires it.',
  avoid:['generic default typography','random mixed typefaces','oversized display text without narrative reason','literal imitation of a reference typeface']
});

const consistencyRules={study_complete_set_before_generating:true,maintain_typography_behaviour:true,maintain_margin_system:true,maintain_colour_grade:true,maintain_motif_language:true,maintain_image_treatment:true,maintain_emotional_progression:true,use_references_only_for_slide_specific_layout_behaviour:true,do_not_create_unrelated_designs_for_individual_slides:true};
const copyOf=s=>s.overlay_text??s.copy??'';
const directionOf=s=>s.direction??s.art??'';
const roleOf=(s,i,count)=>s.role||(i===0?'Opening':i===count-1?'Resolution / CTA':'Development');

export function safeFilename(name,fallback='file'){
  const raw=String(name||fallback).normalize('NFC').replace(/[\\/:*?"<>\u0000-\u001f|]/g,'-').replace(/^\.+/,'').replace(/[ .]+$/g,'').trim();
  return raw||fallback;
}

export function storyArc(slides){
  const byRole=needle=>slides.filter(s=>String(s.role||'').toLowerCase().includes(needle)).map(copyOf).filter(Boolean).join(' ');
  return{opening:byRole('opening')||copyOf(slides[0]||{}),development:byRole('development'),resolution:byRole('resolution')||copyOf(slides.at(-1)||{}),cta_or_interaction:slides.map(s=>s.cta||s.interaction||'').filter(Boolean).join(' ')};
}

function referencePlan(slides,set){
  return slides.map((s,i)=>{
    const strategy=resolveReferenceStrategy(s,i,slides,set);
    return{slide_number:i+1,mode:strategy.mode,library_item_id:strategy.library_item_id,reference_title:strategy.reference_title,reference_filename:strategy.reference_filename,source_location:strategy.source_location,match_score:strategy.match_score,match_reason:strategy.match_reason,fallback_to_editorial_direction:strategy.mode==='editorial_direction_only'};
  });
}

export function slidePrompt(s,i,slides,set,logo){
  const main=s.main||null,strategy=resolveReferenceStrategy(s,i,slides,set);
  return{
    schema_version:'1.2',generation_mode:'single_story_slide',project:'LadyTin Story Studio',
    brand:{vertical:'LadyTin Label',collection:'Laya'},
    story_set:{id:set.id||slug(set.title),title:set.title||'',slide_number:i+1,slide_count:slides.length,role_in_arc:roleOf(s,i,slides.length),overall_set_direction:set.overallDirection||''},
    exact_copy:{overlay_text:copyOf(s),cta:s.cta||'',interaction:s.interaction||'',no_text_overlay:!!s.no_text_overlay,caption_cc:!!s.caption_cc,preserve_exactly:true},
    attachments:{
      main_source_asset:{id:main?.id||s.assetId||'',filename:main?.filename||'',file_type:main?.type||'',required:true},
      selected_design_reference:{id:s.reference?.id||s.referenceId||'',filename:strategy.mode!=='editorial_direction_only'?(s.reference?.filename||''):'',file_type:strategy.mode!=='editorial_direction_only'?(s.reference?.type||''):'',reference_source:strategy.mode,required:strategy.mode!=='editorial_direction_only'},
      logo_overlay:{filename:logo?.filename||'',required_when_applicable:true,instruction:'Use only the exact uploaded logo as a locked final overlay. Never redraw or regenerate it.'}
    },
    reference_strategy:strategy,
    typography:typographyBlock(strategy),
    story_set_consistency:{...consistencyRules},
    slide_art_direction:{content_description:s.content_description||'',composition_instruction:strategy.design_analysis?.composition||strategy.original_editorial_direction?.composition||'',additional_user_direction:directionOf(s),internal_production_note:s.internal_note||'',connection_to_previous_slide:i?`Continue naturally from Slide ${n(i-1)}.`:'This is the opening slide.',connection_to_next_slide:i<slides.length-1?`Lead naturally into Slide ${n(i+1)}.`:'Resolve the complete story set.'},
    creative_rules:[...creativeRules],locked_preservation_rules:{...lockedPreservationRules},
    output:{count:1,format:'PNG',aspect_ratio:'9:16',separate_image:true,no_collage:true,no_phone_mockup:true,no_extra_text:true,no_fake_logo:true}
  };
}

export function bulkPrompt(slides,set,logo){
  const hasLibraryReference=slides.some((s,i)=>resolveReferenceStrategy(s,i,slides,set).source==='reference_library');
  const setTypography=typographyBlock({source:hasLibraryReference?'reference_library':'generated_editorial_direction'});
  return{
    schema_version:'1.2',generation_mode:'bulk_story_set',project:'LadyTin Story Studio',brand:{vertical:'LadyTin Label',collection:'Laya'},
    story_set:{id:set.id||slug(set.title),title:set.title||'',slide_count:slides.length,overall_set_direction:set.overallDirection||'',output_order:'sequential'},
    typography:setTypography,
    story_arc:storyArc(slides),
    complete_reference_plan:{common_design_system:set.referencePlan?.common_design_system||{},slides:referencePlan(slides,set),reference_repetition_warnings:set.referencePlan?.repetition_warnings||[],fallback_decisions:slides.map((s,i)=>{const x=resolveReferenceStrategy(s,i,slides,set);return x.mode==='editorial_direction_only'?{slide_number:i+1,decision:'Original editorial direction generated from the complete story set.'}:null}).filter(Boolean)},
    set_wide_consistency:{study_the_full_story_set_before_generating_slide_1:true,treat_all_slides_as_one_continuous_story:true,maintain_consistent_typography_behaviour:true,maintain_consistent_margins_and_spacing:true,maintain_one_controlled_colour_grade:true,maintain_one_restrained_motif_family:true,maintain_consistent_image_treatment:true,maintain_emotional_and_narrative_progression:true,use_different_references_only_for_slide_specific_layout_behaviour:true,do_not_create_unrelated_designs_for_individual_slides:true,overall_set_direction:set.overallDirection||''},
    generation_instruction:{study_the_complete_story_set_first:true,generate_all_slides_in_this_request:true,stop_after_first_slide:false,generate_in_slide_order:true,output_each_slide_separately:true,preserve_story_continuity:true,do_not_create_a_collage:true},
    locked_preservation_rules:{...lockedPreservationRules},creative_rules:[...creativeRules],
    slides:slides.map((s,i)=>{
      const main=s.main||null,strategy=resolveReferenceStrategy(s,i,slides,set);
      return{slide_number:i+1,role_in_arc:roleOf(s,i,slides.length),exact_copy:{overlay_text:copyOf(s),cta:s.cta||'',interaction:s.interaction||'',no_text_overlay:!!s.no_text_overlay,caption_cc:!!s.caption_cc,preserve_exactly:true},attachments:{main_source_asset:{id:main?.id||s.assetId||'',filename:main?.filename||'',file_type:main?.type||''},selected_design_reference:{id:s.reference?.id||'',filename:strategy.mode!=='editorial_direction_only'?(s.reference?.filename||''):'',file_type:strategy.mode!=='editorial_direction_only'?(s.reference?.type||''):'',reference_source:strategy.mode},logo_overlay:{filename:logo?.filename||''}},reference_strategy:strategy,typography:typographyBlock(strategy),art_direction:{content_description:s.content_description||'',additional_user_direction:directionOf(s),internal_production_note:s.internal_note||'',composition:strategy.design_analysis?.composition||strategy.original_editorial_direction?.composition||'',continuity:`Slide ${i+1} must remain related to the complete set while serving its distinct ${roleOf(s,i,slides.length)} role.`},output:{count:1,format:'PNG',aspect_ratio:'9:16',separate_image:true}};
    }),
    expected_results:{number_of_images:slides.length,file_naming:slides.map((_,i)=>`slide-${n(i)}.png`)}
  };
}

function hasBinary(asset){return!!asset?.file&&typeof asset.file.arrayBuffer==='function'}

export function referenceReady(s,i,slides,set){
  const strategy=resolveReferenceStrategy(s,i,slides,set);
  if(strategy.mode==='manual_upload')return!!s.reference&&(hasBinary(s.reference)||!!s.reference.storage_path);
  if(strategy.mode==='library_reference')return!!s.reference&&(hasBinary(s.reference)||!!s.reference.storage_path||s.reference.source_type==='google_drive');
  return strategy.mode==='editorial_direction_only'&&!!strategy.original_editorial_direction?.concept_title;
}

export function readiness(slides,set,logo){
  return slides.map((s,i)=>{
    const missing=[],hasCopy=!!copyOf(s).trim()||!!s.no_text_overlay;
    if(!hasCopy)missing.push('confirmed copy or no-text-overlay');
    if(!s.main)missing.push('main asset');else if(!hasBinary(s.main)&&!s.main.storage_path)missing.push('main asset binary unavailable');
    if(!referenceReady(s,i,slides,set))missing.push('valid reference strategy');
    const json=parseJson(pretty(slidePrompt(s,i,slides,set,logo))).ok;
    return{slide:i+1,main:!!s.main&&(hasBinary(s.main)||!!s.main.storage_path),reference:referenceReady(s,i,slides,set),referenceMode:resolveReferenceStrategy(s,i,slides,set).mode,json,ready:missing.length===0&&json,missing};
  });
}

async function binary(asset,label,slideNumber,remoteLoader){
  if(!asset)throw new Error(`Slide ${slideNumber}: ${label} is not assigned.`);
  if(hasBinary(asset)){
    const bytes=await asset.file.arrayBuffer();
    if(!bytes.byteLength)throw new Error(`Slide ${slideNumber}: ${label} file "${asset.filename||'unknown'}" is empty.`);
    return bytes;
  }
  if(asset.storage_path&&remoteLoader){
    const loaded=await remoteLoader(asset);
    const bytes=loaded instanceof Blob?await loaded.arrayBuffer():loaded instanceof Uint8Array?loaded.buffer.slice(loaded.byteOffset,loaded.byteOffset+loaded.byteLength):loaded;
    if(!bytes?.byteLength)throw new Error(`Slide ${slideNumber}: cloud ${label} file "${asset.filename||'unknown'}" is empty.`);
    return bytes;
  }
  throw new Error(`Slide ${slideNumber}: the original uploaded ${label} file "${asset.filename||'unknown'}" is no longer available. Please upload it again.`);
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

export async function makeSlideZip(s,i,slides,set,logo,remoteLoader){
  const row=readiness(slides,set,logo)[i];
  if(!s.main)throw new Error('Assign a main asset before downloading this slide package.');
  if(!row?.reference)throw new Error('Choose a valid reference strategy before downloading this slide package.');
  if(!row?.json)throw new Error(`Slide ${i+1}: the JSON prompt is invalid.`);
  const sn=n(i),root=`LadyTin-${slug(set.title)}-slide-${sn}`,zip=new JSZip(),folder=zip.folder(root),strategy=resolveReferenceStrategy(s,i,slides,set),mainName=`main-asset-${safeFilename(s.main.filename,'main-asset')}`,promptName=`slide-${sn}-prompt.json`,mainBytes=await binary(s.main,'main asset',i+1,remoteLoader);
  folder.file(promptName,validatedJson(slidePrompt(s,i,slides,set,logo),promptName));
  folder.file(mainName,mainBytes,{binary:true});
  let refName='';
  if(strategy.mode==='manual_upload'||strategy.mode==='library_reference'){
    refName=`selected-reference-${safeFilename(s.reference.filename,'selected-reference')}`;
    folder.file(refName,await binary(s.reference,'design reference',i+1,remoteLoader),{binary:true});
  }
  const manifest={schema_version:'1.0',package_type:'LadyTin_single_story_slide_generation',story_set_title:set.title||'',slide_number:i+1,reference_mode:strategy.mode,reference_requirement_satisfied:true,reference_binary_included:!!refName,files:{prompt:promptName,main_asset:mainName,selected_reference:refName},ready_for_generation:true,missing_requirements:[]};
  folder.file('manifest.json',validatedJson(manifest,'manifest.json'));
  folder.file('README.txt',`Upload ${promptName} together with the main asset${refName?' and the selected reference':''}. Follow the prompt's typography behaviour and complete-set consistency rules. References supply transferable editorial logic only; do not copy exact artwork or typefaces.`);
  return generateZip(zip);
}

export async function makeZip(slides,set,logo,incomplete=false,remoteLoader){
  const rows=readiness(slides,set,logo);
  if(!incomplete&&rows.some(r=>!r.ready))throw new Error('Resolve every slide’s main asset and reference strategy before downloading the complete story-set package.');
  const root=`LadyTin-${slug(set.title)}-bulk-generation-package`,zip=new JSZip(),folder=zip.folder(root);
  folder.file('bulk-story-set-prompt.json',validatedJson(bulkPrompt(slides,set,logo),'bulk-story-set-prompt.json'));
  folder.file('README.txt','Upload bulk-story-set-prompt.json and all main assets. Selected references are in selected-references. Slides using Original Editorial Direction require no external reference binary. Study the complete set before generating every slide in order as a separate 9:16 image. Do not create a collage. Follow the typography behaviour specified per slide while maintaining one coherent set-wide system.');
  const manifest={schema_version:'1.2',package_type:'LadyTin_bulk_story_set_generation',story_set_id:set.id||slug(set.title),story_set_title:set.title,slide_count:slides.length,files:{bulk_prompt:'bulk-story-set-prompt.json',slide_prompts_directory:'slide-prompts/',main_assets_directory:'main-assets/',references_directory:'selected-references/',logos_directory:'logos/'},slides:[]};
  for(const[i,s]of slides.entries()){
    const sn=n(i),promptPath=`slide-prompts/slide-${sn}-prompt.json`,strategy=resolveReferenceStrategy(s,i,slides,set),missing=[...rows[i].missing];
    folder.file(promptPath,validatedJson(slidePrompt(s,i,slides,set,logo),promptPath));
    let mainPath='',refPath='';
    if(s.main){
      mainPath=`main-assets/slide-${sn}-${safeFilename(s.main.filename,'main-asset')}`;
      try{folder.file(mainPath,await binary(s.main,'main asset',i+1,remoteLoader),{binary:true})}
      catch(error){if(!incomplete)throw error;mainPath='';missing.push(error.message)}
    }
    if((strategy.mode==='manual_upload'||strategy.mode==='library_reference')&&s.reference){
      refPath=`selected-references/slide-${sn}-${safeFilename(s.reference.filename,'selected-reference')}`;
      try{folder.file(refPath,await binary(s.reference,'design reference',i+1,remoteLoader),{binary:true})}
      catch(error){if(!incomplete)throw error;refPath='';missing.push(error.message)}
    }
    manifest.slides.push({slide_number:i+1,prompt_file:promptPath,main_asset_file:mainPath,reference_file:refPath,reference_mode:strategy.mode,reference_requirement_satisfied:rows[i].reference,reference_binary_included:!!refPath,logo_file:logo?`logos/${safeFilename(logo.filename,'logo')}`:'',ready_for_generation:rows[i].ready&&missing.length===0,missing_requirements:[...new Set(missing)]});
  }
  if(logo){
    try{folder.file(`logos/${safeFilename(logo.filename,'logo')}`,await binary(logo,'logo',0,remoteLoader),{binary:true})}
    catch(error){if(!incomplete)throw error;manifest.logo_error=error.message}
  }
  folder.file('manifest.json',validatedJson(manifest,'manifest.json'));
  return generateZip(zip);
}
