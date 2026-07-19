export const makeSlide=(number=1)=>({
  id:`slide-${number}-${Math.random().toString(36).slice(2,8)}`,
  slide_number:number,
  rawSlideText:'',overlay_text:'',copy:'',cta:'',interaction:'',direction:'',art:'',
  content_description:'',internal_note:'',no_text_overlay:false,caption_cc:false,
  role:number===1?'Opening':'Development',main:null,reference:null,assetId:'',referenceId:''
});

const setHeader=/^\s*(?:(?:STORY\s+)?SET\s*(\d+)\s*(?:—|–|-|:)\s*(.+)|(?:STORY\s+)?SET\s*(\d+)\s*)$/i;
const slideHeader=/^\s*(?:SLIDE\s*(\d+)|S(\d+)|(\d+)\.)\s*(?:(?:—|–|-|:)\s*)?(.*)$/i;
const manualBreak=/^\s*(?:---\s*)?SLIDE\s+BREAK(?:\s*---)?\s*$/i;
const labelLine=/^\s*(Direction|Visual direction|Video direction|Asset direction|CTA|Interaction|Poll|Question|Sticker|Text overlay|Copy|Notes?|Optional|Internal note)\s*:\s*(.*)$/i;

const trimOuter=s=>s.replace(/^\s+|\s+$/g,'');
const cleanFlags=s=>{
  let value=s;
  const noText=/no\s*[- ]?text\s+overlay/i.test(value);
  const caption=/caption(?:s)?\s*CC|caption\s+cc/i.test(value);
  value=value.replace(/\s*(?:-|—|–)?\s*No\s*[- ]?text\s+overlay(?:\s+but\s+caption(?:s)?\s*CC)?\s*/ig,' ').trim();
  value=value.replace(/\s*(?:-|—|–)?\s*caption(?:s)?\s*CC\s*/ig,' ').trim();
  return{value,noText,caption};
};
const isMediaDescription=s=>/\b(video|photo|image|reel|boomerang|footage|shot|talking|voiceover|animation|asset)\b/i.test(s);

function parseSlide(number,raw,inline,warnings){
  const s=makeSlide(number);s.rawSlideText=raw;
  const lines=raw.split('\n');
  let initial=trimOuter(inline||'');
  let expectingCTA=/^CTA\s*$/i.test(initial),overlay=expectingCTA?'':initial;
  const direction=[],notes=[],unclassified=[];
  for(let index=1;index<lines.length;index++){
    let line=lines[index];if(!line.trim())continue;
    const par=line.trim().match(/^\((.*)\)$/);if(par)line=par[1];
    if(/^no\s*[- ]?text\s+overlay(?:\s+but\s+caption(?:s)?\s*cc)?$/i.test(line.trim())){s.no_text_overlay=true;if(/caption/i.test(line))s.caption_cc=true;continue}
    if(/^(poll|question box|question|sticker)$/i.test(line.trim())){s.interaction=line.trim().replace(/ box$/i,'');continue}
    const m=line.match(labelLine);
    if(m){const key=m[1].toLowerCase(),val=m[2];
      if(key==='cta'){s.cta=val;continue}
      if(['interaction','poll','question','sticker'].includes(key)){s.interaction=val||m[1];continue}
      if(['direction','visual direction','video direction','asset direction'].includes(key)){const f=cleanFlags(val);if(f.value)direction.push(f.value);s.no_text_overlay||=f.noText;s.caption_cc||=f.caption;continue}
      if(['notes','note','optional','internal note'].includes(key)){notes.push(val);continue}
      if(['text overlay','copy'].includes(key)){overlay=val;continue}
    }
    if(expectingCTA&&!s.cta){s.cta=line.trim();expectingCTA=false;continue}
    unclassified.push(line);
  }
  const rawFlags=cleanFlags([overlay,...direction,...unclassified].join(' '));s.no_text_overlay||=rawFlags.noText;s.caption_cc||=rawFlags.caption;
  if(s.no_text_overlay&&overlay&&isMediaDescription(overlay)){s.content_description=overlay;overlay=''}
  if(!s.no_text_overlay&&overlay&&isMediaDescription(overlay)&&direction.length){s.content_description=overlay;overlay=''}
  if(unclassified.length){if(!overlay)overlay=unclassified.join('\n');else notes.push(...unclassified)}
  if(s.no_text_overlay&&overlay&&!s.content_description&&isMediaDescription(overlay)){s.content_description=overlay;overlay=''}
  s.overlay_text=overlay;s.copy=overlay;s.direction=direction.join('\n');s.art=s.direction;s.internal_note=notes.join('\n');
  if(!s.overlay_text&&!s.no_text_overlay)warnings.push(`Slide ${number} has no visible overlay copy.`);
  return s;
}

function parseSet(raw,titleHint,index){
  const warnings=[],lines=raw.split('\n');let title=titleHint||'';
  const markers=[];
  lines.forEach((line,i)=>{const m=line.match(slideHeader);if(m)markers.push({line:i,number:+(m[1]||m[2]||m[3]),inline:m[4]||''});else if(manualBreak.test(line))markers.push({line:i,number:markers.length+1,inline:''})});
  if(!title){const candidate=lines.find(l=>l.trim()&&!slideHeader.test(l)&&!labelLine.test(l));if(candidate)title=candidate.trim()}
  if(!title)warnings.push('No story-set title was detected.');
  const nums=new Set();for(const m of markers){if(nums.has(m.number))warnings.push(`Two Slide ${m.number} markers were found.`);nums.add(m.number)}
  let slides=[];
  if(!markers.length){warnings.push('No explicit slide markers were found.');const body=lines.filter(l=>l.trim()!==title).join('\n').trim();slides=[parseSlide(1,body,body,warnings)]}
  else slides=markers.map((m,j)=>{const end=markers[j+1]?.line??lines.length;return parseSlide(m.number,lines.slice(m.line,end).join('\n'),m.inline,warnings)});
  slides.forEach((s,i)=>{s.slide_number=i+1;s.id=`slide-${i+1}-${Math.random().toString(36).slice(2,8)}`;s.role=i===0?'Opening':i===slides.length-1?(s.cta||s.interaction?'CTA / Interaction':'Resolution'):'Development'});
  return{id:`set-${index+1}-${Math.random().toString(36).slice(2,8)}`,title:title||`Untitled Story Set ${index+1}`,rawStorySetCopy:raw,parseStatus:'review',parseWarnings:warnings,slides,included:true,bp:null,defaultRef:null,logo:null};
}

export function parseStorySets(input){
  const raw=String(input??'').replace(/\r\n?/g,'\n');const lines=raw.split('\n'),headers=[];
  lines.forEach((line,i)=>{const m=line.match(setHeader);if(m)headers.push({line:i,title:(m[2]||'').trim(),number:+(m[1]||m[3])})});
  let sets=[];
  if(headers.length){sets=headers.map((h,i)=>{const end=headers[i+1]?.line??lines.length;return parseSet(lines.slice(h.line+1,end).join('\n').replace(/^\n+|\n+$/g,''),h.title,i)})}
  else sets=[parseSet(raw,'',0)];
  return{raw,sets,totalSlides:sets.reduce((a,s)=>a+s.slides.length,0),warnings:sets.flatMap(s=>s.parseWarnings)};
}
