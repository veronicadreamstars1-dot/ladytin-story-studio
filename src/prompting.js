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
    story_set:{
      id:set.id||slug(set.title),title:set.title||'',slide_number:i+1,slide_count:slides.length,
      role_in_arc:roleOf(s,i,slides.length),overall_set_direction:set.overallDirection||''
    },
    exact_copy:{
      overlay_text:copyOf(s),cta:s.cta||'',interaction:s.interaction||'',
      no_text_overlay:!!s.no_text_overlay,caption_cc:!!s.caption_cc,preserve_exactly:true
    },
    attachments:{
      main_source_asset:{id:main?.id||s.assetId||'',filename:main?.filename||'',file_type:main?.type||'',required:true},
      selected_design_reference:{id:ref?.id||s.referenceId||'',filename:ref?.filename||'',file_type:ref?.type||'',required:true},
      logo_overlay:{filename:logo?.filename||'',required_when_applicable:true,instruction:'Use only the exact uploaded logo as a locked final overlay. Never redraw or regenerate it.'}
    },
    story_set_consistency:{...consistencyRules},
    slide_art_direction:{
      content_description:s.content_description||'',composition_instruction:'',
      additional_user_direction:directionOf(s),internal_production_note:s.internal_note||'',
      connection_to_previous_slide:i?`Continue naturally from Slide ${n(i-1)}.`:'This is the opening slide.',
      connection_to_next_slide:i<slides.length-1?`Lead naturally into Slide ${n(i+1)}.`:'Resolve the complete story set.'
    },
    creative_rules:[...creativeRules],
    locked_preservation_rules:{...lockedPreservationRules},
    output:{count:1,format:'PNG',aspect_ratio:'9:16',separate_image:true,no_collage:true,no_phone_mockup:true,no_extra_text:true,no_fake_logo:true}
  };
}

export function bulkPrompt(slides,set,logo){
  return{
    schema_version:'1.0',generation_mode:'bulk_story_set',project:'LadyTin Story Studio',
    brand:{vertical:'LadyTin Label',collection:'Laya'},
    story_set:{id:set.id||slug(set.title),title:set.title||'',slide_count:slides.length,overall_set_direction:set.overallDirection||'',output_order:'sequential'},
    story_arc:storyArc(slides),
    set_wide_consistency:{
      study_the_full_story_set_before_generating_slide_1:true,treat_all_slides_as_one_continuous_story:true,
      maintain_consistent_typography_behaviour:true,maintain_consistent_margins_and_spacing:true,
      maintain_one_controlled_colour_grade:true,maintain_one_restrained_motif_family:true,
      maintain_consistent_image_treatment:true,maintain_emotional_and_narrative_progression:true,
      use_different_references_only_for_slide_specific_layout_behaviour:true,
      do_not_create_unrelated_designs_for_individual_slides:true,
      overall_set_direction:set.overallDirection||''
    },
    generation_instruction:{
      study_the_complete_story_set_first:true,generate_all_slides_in_this_request:true,stop_after_first_slide:false,
      generate_in_slide_order:true,output_each_slide_separately:true,preserve_story_continuity:true,do_not_create_a_collage:true
    },
    locked_preservation_rules:{...lockedPreservationRules},
    creative_rules:[...creativeRules],
    slides:slides.map((s,i)=>{
      const ref=s.reference||null,main=s.main||null;
      return{
        slide_number:i+1,role_in_arc:roleOf(s,i,slides.length),
        exact_copy:{overlay_text:copyOf(s),cta:s.cta||'',interaction:s.interaction||'',no_text_overlay:!!s.no_text_overlay,caption_cc:!!s.caption_cc,preserve_exactly:true},
        attachments:{
          main_source_asset:{id:main?.id||s.assetId||'',filename:main?.filename||'',file_type:main?.type||''},
          selected_design_reference:{id:ref?.id||s.referenceId||'',filename:ref?.filename||'',file_type:ref?.type||''},
          logo_overlay:{filename:logo?.filename||''}
        },
        art_direction:{content_description:s.content_description||'',additional_user_direction:directionOf(s),internal_production_note:s.internal_note||''},
        output:{count:1,format:'PNG',aspect_ratio:'9:16',separate_image:true}
      };
    }),
    expected_results:{number_of_images:slides.length,file_naming:slides.map((_,i)=>`slide-${n(i)}.png`)}
  };
}

export function readiness(slides,set,logo){
  return slides.map((s,i)=>{
    const missing=[],hasCopy=!!copyOf(s).trim()||!!s.no_text_overlay;
    if(!hasCopy)missing.push('confirmed copy or no-text-overlay');
    if(!s.main)missing.push('main asset');
    if(!s.reference)missing.push('design reference');
    const json=parseJson(pretty(slidePrompt(s,i,slides,set,logo))).ok;
    return{slide:i+1,main:!!s.main,reference:!!s.reference,json,ready:missing.length===0&&json,missing};
  });
}

async function fileBytes(file){return new Uint8Array(await file.arrayBuffer())}
const te=new TextEncoder();
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0};
const u16=n=>[n&255,n>>8&255],u32=n=>[n&255,n>>8&255,n>>16&255,n>>24&255];

async function zipBlob(entries){
  let offset=0,parts=[],central=[];
  for(const e of entries){
    const name=te.encode(e.path),data=e.data instanceof Uint8Array?e.data:te.encode(e.data),sum=crc(data);
    const head=new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,0,0,...u32(sum),...u32(data.length),...u32(data.length),...u16(name.length),0,0]);
    parts.push(head,name,data);central.push({name,data,sum,offset});offset+=head.length+name.length+data.length;
  }
  const start=offset;
  for(const c of central){
    const h=new Uint8Array([80,75,1,2,20,0,20,0,0,0,0,0,0,0,0,0,...u32(c.sum),...u32(c.data.length),...u32(c.data.length),...u16(c.name.length),0,0,0,0,0,0,0,0,0,0,...u32(c.offset)]);
    parts.push(h,c.name);offset+=h.length+c.name.length;
  }
  parts.push(new Uint8Array([80,75,5,6,0,0,0,0,...u16(central.length),...u16(central.length),...u32(offset-start),...u32(start),0,0]));
  return new Blob(parts,{type:'application/zip'});
}

export async function makeSlideZip(s,i,slides,set,logo){
  const root=`LadyTin-${slug(set.title)}-slide-${n(i)}`,entries=[];
  entries.push({path:`${root}/slide-${n(i)}-prompt.json`,data:pretty(slidePrompt(s,i,slides,set,logo))});
  if(s.main?.file)entries.push({path:`${root}/main-asset-${s.main.filename}`,data:await fileBytes(s.main.file)});
  if(s.reference?.file)entries.push({path:`${root}/selected-reference-${s.reference.filename}`,data:await fileBytes(s.reference.file)});
  return zipBlob(entries);
}

export async function makeZip(slides,set,logo,incomplete=false){
  const rows=readiness(slides,set,logo);
  if(!incomplete&&rows.some(r=>!r.ready))throw Error('Package is not ready.');
  const root=`LadyTin-${slug(set.title)}-bulk-generation-package`,entries=[];
  const add=(path,data)=>entries.push({path:`${root}/${path}`,data});
  add('bulk-story-set-prompt.json',pretty(bulkPrompt(slides,set,logo)));
  add('README.txt','Upload bulk-story-set-prompt.json and all files from main-assets and selected-references. Study the complete set before generating. Generate every slide in order as a separate 9:16 image. Do not create a collage. Review story continuity before approval.');
  const manifest={schema_version:'1.0',package_type:'LadyTin_bulk_story_set_generation',story_set_id:set.id||slug(set.title),story_set_title:set.title,slide_count:slides.length,files:{bulk_prompt:'bulk-story-set-prompt.json',slide_prompts_directory:'slide-prompts/',main_assets_directory:'main-assets/',references_directory:'selected-references/',logos_directory:'logos/'},slides:[]};
  for(const [i,s]of slides.entries()){
    const sn=n(i),mp=s.main?`main-assets/slide-${sn}-${s.main.filename}`:'',rp=s.reference?`selected-references/slide-${sn}-${s.reference.filename}`:'';
    add(`slide-prompts/slide-${sn}-prompt.json`,pretty(slidePrompt(s,i,slides,set,logo)));
    if(s.main?.file)add(mp,await fileBytes(s.main.file));
    if(s.reference?.file)add(rp,await fileBytes(s.reference.file));
    manifest.slides.push({slide_number:i+1,prompt_file:`slide-prompts/slide-${sn}-prompt.json`,main_asset_file:mp,reference_file:rp,logo_file:logo?`logos/${logo.filename}`:'',ready_for_generation:rows[i].ready,missing_requirements:rows[i].missing});
  }
  if(logo?.file)add(`logos/${logo.filename}`,await fileBytes(logo.file));
  add('manifest.json',pretty(manifest));
  return zipBlob(entries);
}
