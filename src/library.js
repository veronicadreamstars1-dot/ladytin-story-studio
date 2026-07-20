export const REFERENCE_MODES=['library_reference','manual_upload','editorial_direction_only'];
export const MAIN_ASSET_SOURCES=['library_media','manual_upload'];

export const REFERENCE_TYPOGRAPHY_GUIDANCE='Translate the selected reference through hierarchy, scale, alignment, case, spacing and restraint. Do not copy or imitate its exact typeface. Choose a refined type system appropriate to LadyTin, the exact copy and the complete story set.';
export const ORIGINAL_TYPOGRAPHY_GUIDANCE='Choose one refined editorial type system appropriate to the story, copy length, garment and complete set. Keep its behaviour consistent across slides, avoid generic defaults, and do not mix random typefaces.';

const TAGS={
  composition:['centred','asymmetric','split layout','full bleed','framed','layered','negative space','editorial grid','oversized crop','typographic composition','image-led','object-led','cinematic still'],
  typography:['serif editorial','clean grotesk','monospaced','handwritten accent','restrained caption','oversized display type','vertical typography','no typography'],
  mood:['intimate','tactile','quiet luxury','poetic','warm','archival','modern Indian','crafted','minimal','cinematic','playful','contemplative','grounded','aspirational'],
  treatment:['paper texture','fabric texture','grain','soft shadow','torn edge','linework','embossing','translucent layer','organic shape','restrained motif','clean flat field','photographic realism'],
  colour:['ivory','warm neutral','earthy','jewel tone','monochrome','muted','high contrast','soft pastel','deep dark','controlled accent colour'],
  narrative:['opening','introduction','development','process','detail','emotional pause','engagement','transition','reveal','resolution','CTA']
};

const KEYWORDS={
  'negative space':['negative space','minimal','quiet','spacious','white space'],'full bleed':['full bleed','edge to edge','cinematic'],'framed':['frame','border','mat'],'layered':['layer','overlap'],'editorial grid':['editorial','magazine','grid'],'oversized crop':['crop','close-up','detail'],'typographic composition':['type','typography','poster','headline'],'serif editorial':['serif','editorial','magazine'],'clean grotesk':['sans','grotesk','clean type'],'handwritten accent':['handwritten','script','scribble'],'no typography':['no text','image only'],'intimate':['intimate','personal','close'],'tactile':['tactile','fabric','texture','handmade'],'quiet luxury':['quiet luxury','refined','premium'],'poetic':['poetic','dreamy','lyrical'],'modern Indian':['india','indian','craft','heritage'],'crafted':['craft','handmade','artisan'],'minimal':['minimal','simple','restrained'],'cinematic':['cinematic','film','still'],'paper texture':['paper','paper texture'],'fabric texture':['fabric','textile','cloth'],'grain':['grain','film grain'],'linework':['linework','drawing','sketch'],'restrained motif':['motif','pattern','ornament'],'photographic realism':['photograph','photo','realism'],'ivory':['ivory','cream','off white'],'earthy':['earthy','brown','terracotta'],'jewel tone':['jewel','maroon','emerald','sapphire'],'muted':['muted','soft colour'],'deep dark':['black','midnight','dark'],'opening':['opening','intro','beginning'],'process':['process','making','behind the scenes'],'detail':['detail','close-up','texture'],'engagement':['poll','question','interactive'],'reveal':['reveal','full look'],'resolution':['ending','final','resolution'],'CTA':['cta','shop','discover','explore']
};

export function hashString(value=''){
  let h=2166136261;
  for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}
  return(h>>>0).toString(16).padStart(8,'0');
}

function textOf(item){return[item.title,item.description,item.original_filename,item.media_category,(item.tags||[]).join(' ')].filter(Boolean).join(' ').toLowerCase()}

export function inferVisualTags(item){
  const text=textOf(item),out={composition:[],typography:[],mood:[],treatment:[],colour:[],narrative:[]};
  for(const[tag,words]of Object.entries(KEYWORDS)){
    if(words.some(w=>text.includes(w))){
      for(const[group,allowed]of Object.entries(TAGS))if(allowed.includes(tag))out[group].push(tag);
    }
  }
  if(!out.composition.length)out.composition.push(text.length%2?'asymmetric':'image-led');
  if(!out.typography.length)out.typography.push('restrained caption');
  if(!out.mood.length)out.mood.push('quiet luxury','minimal');
  if(!out.treatment.length)out.treatment.push('photographic realism');
  if(!out.colour.length)out.colour.push('muted');
  if(!out.narrative.length)out.narrative.push('development');
  return out;
}

export function designAnalysis(item,tags=inferVisualTags(item)){
  return{
    composition:tags.composition.join(', '),
    hierarchy:tags.composition.includes('negative space')?'One clear focal image with generous breathing room.':'A controlled editorial focal hierarchy with one dominant visual.',
    typography_behaviour:tags.typography.join(', '),
    typography_translation:REFERENCE_TYPOGRAPHY_GUIDANCE,
    spacing:tags.composition.includes('editorial grid')?'Measured grid spacing and aligned margins.':'Deliberate spacing with restrained margins.',
    image_treatment:tags.treatment.join(', '),
    colour_behaviour:tags.colour.join(', '),
    emotional_quality:tags.mood.join(', '),
    transferable_principles:['hierarchy','crop behaviour','negative space','spatial rhythm','editorial restraint'],
    do_not_copy:['exact artwork','copy','branding','model','garment','proprietary graphic elements'],
    summary:`Use the reference for ${tags.composition.join(', ')}, ${tags.typography.join(', ')} and ${tags.mood.join(', ')} behaviour without reproducing the original artwork.`
  };
}

function roleTerms(slide){
  const role=String(slide.role||'').toLowerCase(),copy=[slide.copy,slide.overlay_text,slide.cta,slide.interaction,slide.content_description].join(' ').toLowerCase(),terms=[];
  if(role.includes('opening'))terms.push('opening','introduction','negative space');
  if(role.includes('development'))terms.push('development','process','detail');
  if(role.includes('engagement')||slide.interaction)terms.push('engagement','playful','typographic composition');
  if(role.includes('resolution')||slide.cta)terms.push('resolution','CTA','reveal','aspirational');
  if(copy.length>120)terms.push('negative space','restrained caption');
  if(/craft|hand|fabric|stitch|texture/i.test(copy))terms.push('tactile','crafted','fabric texture','detail');
  if(/colour|palette|yellow|blue|maroon|ivory/i.test(copy))terms.push('controlled accent colour','jewel tone','soft pastel');
  return terms;
}

export function scoreReferenceForSlide(item,slide,set={},context={}){
  const tags=Object.values(item.visual_tags||inferVisualTags(item)).flat(),terms=roleTerms(slide);
  let score=35;
  score+=terms.filter(t=>tags.includes(t)).length*9;
  const copy=String(slide.copy||slide.overlay_text||'');
  if(copy.length>120&&tags.includes('negative space'))score+=10;
  if(copy.length<45&&(tags.includes('oversized display type')||tags.includes('typographic composition')))score+=7;
  if(slide.interaction&&tags.includes('engagement'))score+=12;
  if(slide.cta&&(tags.includes('CTA')||tags.includes('resolution')))score+=10;
  const adjacent=context.adjacentReferences||[];
  if(adjacent.some(ref=>ref?.id===item.id))score-=18;
  const used=context.usedReferences||[];
  score-=used.filter(id=>id===item.id).length*12;
  return Math.max(0,Math.min(100,Math.round(score)));
}

export function recommendReferencesForSlide(items,slide,set={},context={}){
  return items.map(item=>({item,score:scoreReferenceForSlide(item,slide,set,context)}))
    .filter(x=>x.score>=45)
    .sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id))
    .slice(0,3)
    .map(x=>({...x,reason:`Matches the slide's ${String(slide.role||'story').toLowerCase()} role through ${(x.item.visual_tags?.composition||[]).slice(0,2).join(' and ')} with ${(x.item.visual_tags?.mood||[]).slice(0,2).join(' and ')} restraint.`}));
}

export function buildReferencePlan(set,references){
  const used=[],plan=[];
  for(let i=0;i<set.slides.length;i++){
    const slide=set.slides[i];
    if(slide.referenceLocked&&slide.reference?.id){
      const item=references.find(ref=>ref.id===slide.reference.id)||slide.reference;
      plan.push({slide_number:i+1,mode:'library_reference',selected_reference:item,recommendations:[{item,score:100,reason:'Locked by the user.'}]});
      used.push(item.id);
      continue;
    }
    const recs=recommendReferencesForSlide(references,slide,set,{usedReferences:used,adjacentReferences:[plan.at(-1)?.selected_reference].filter(Boolean)}),selected=recs[0]?.score>=52?recs[0].item:null;
    if(selected)used.push(selected.id);
    plan.push({slide_number:i+1,mode:selected?'library_reference':'editorial_direction_only',selected_reference:selected,recommendations:recs});
  }
  return{slides:plan,common_design_system:{typography:'One refined editorial hierarchy adapted from selected references or original direction without copying exact typefaces.',margins:'One measured safe-area and margin system across all slides.',colour:'Controlled progression derived from the source garments and story emotion.',image_treatment:'Premium photographic realism with consistent tonal restraint.',motif:'One subtle recurring motif derived from fabric, linework or craft details.'},repetition_warnings:used.filter((id,i)=>used.indexOf(id)!==i),generated_at:new Date().toISOString()};
}

export function editorialDirectionForSlide(slide,index,count,set={}){
  const role=slide.role||'Development',copy=String(slide.copy||slide.overlay_text||'');
  return{
    concept_title:`${role} - Original Editorial Direction`,
    narrative_intention:`Create a ${role.toLowerCase()} image that makes direct emotional sense with the exact copy and advances the complete LadyTin story set.`,
    composition:index===0?'A confident opening frame with one focal subject and generous negative space.':index===count-1?'A resolved, memorable closing composition with a clear CTA area.':'A distinct but related editorial composition that continues the visual rhythm.',
    crop:/detail|craft|fabric|stitch/i.test(copy)?'Use a precise tactile close crop while preserving the exact garment details.':'Use a considered fashion-editorial crop that preserves identity, pose and outfit.',
    typography:ORIGINAL_TYPOGRAPHY_GUIDANCE,
    copy_placement:'Place exact copy in a protected negative-space area with consistent set margins.',
    negative_space:'Preserve enough clean space for copy and breathing room.',
    palette:'Derive a controlled palette from the exact outfit and the complete set progression.',
    texture:'Use subtle tactile or paper/fabric texture only when it supports the narrative.',
    motif:'Use one restrained motif derived from the garment print, embroidery or craft detail.',
    connection_to_adjacent_slides:`Maintain continuity with Slide ${Math.max(1,index)} and Slide ${Math.min(count,index+2)} through spacing, colour grade and image treatment.`,
    avoid:['generic Canva layout','literal reference copy','cluttered collage','random decorative shapes','excessive gold','fake logos','stock-photo aesthetics','obvious AI artefacts']
  };
}

export function resolveReferenceStrategy(slide,index,slides,set){
  const mode=REFERENCE_MODES.includes(slide.referenceMode)?slide.referenceMode:(slide.reference?'library_reference':'editorial_direction_only');
  if(mode==='manual_upload'&&slide.reference)return{mode,source:'uploaded',library_item_id:'',reference_title:slide.reference.title||'',reference_filename:slide.reference.filename||'',source_location:slide.reference.source_location||'supabase_storage',match_score:null,match_reason:'Slide-only manual reference selected by the user.',design_analysis:slide.manualDesignAnalysis||{},original_editorial_direction:{}};
  if(mode==='library_reference'&&slide.reference)return{mode,source:'reference_library',library_item_id:slide.reference.id||slide.referenceId||'',reference_title:slide.reference.title||slide.reference.filename||'',reference_filename:slide.reference.filename||'',source_location:slide.reference.source_location||slide.reference.source_type||'supabase_storage',match_score:slide.referenceMatchScore??null,match_reason:slide.referenceMatchReason||'Selected from the shared Reference Library.',design_analysis:slide.reference.design_analysis||designAnalysis(slide.reference),original_editorial_direction:{}};
  const editorial=editorialDirectionForSlide(slide,index,slides.length,set);
  return{mode:'editorial_direction_only',source:'generated_editorial_direction',library_item_id:'',reference_title:'',reference_filename:'',source_location:'',match_score:null,match_reason:'No fixed reference was selected; use the generated original editorial direction.',design_analysis:{},original_editorial_direction:editorial};
}

export function applyReferencePlan(set,plan){
  set.referencePlan=plan;
  plan.slides.forEach((item,i)=>{
    const s=set.slides[i];
    if(!s||s.referenceLocked)return;
    if(item.selected_reference){s.referenceMode='library_reference';s.reference=item.selected_reference;s.referenceId=item.selected_reference.id;s.referenceMatchScore=item.recommendations[0]?.score??null;s.referenceMatchReason=item.recommendations[0]?.reason||''}
    else{s.referenceMode='editorial_direction_only';s.reference=null;s.referenceId='';s.referenceMatchScore=null;s.referenceMatchReason=''}
  });
  return set;
}
