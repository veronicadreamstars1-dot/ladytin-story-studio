import assert from'node:assert/strict';
import{bulkPrompt,makeSlideZip,makeZip,parseJson,pretty,readiness,slidePrompt,slug,storyArc}from'../src/prompting.js';
import{parseStorySets}from'../src/parser.js';

const sample=`SET 1 — The Rhythm of Laya

Slide 1 — Tina talking video
Direction: She talks about getting to California and feeling like she had finally arrived - No text overlay but caption CC

Slide 2 — CTA
Discover Laya.


SET 2 — The Journey of a Garment

Slide 1 — It starts on a wall covered in paper. Everything still possible.

Slide 2 — Then it reaches hands in India. Hands that have been stitching this way for generations.

Slide 3 — The smallest details are always added last. That is where everything comes together.

Slide 4 — What reaches you is not just one garment. It carries centuries of craft, hundreds of hands, and one shared intention.
(CTA: See where it begins.)


SET 3 — Touch, Texture and Craft

Slide 1 — The first thing I do when looking for a new fabric is close my eyes and feel it. If it does not feel right, it does not make it in.

Slide 2 — I have driven hours for the right cloth. That is what it takes.

Slide 3 — Every choice here was deliberate. What you wear when you wear this is not just fabric. It is intention.
(CTA: Feel the difference.)


SET 4 — Which Colour Speaks to You?

Slide 1 — I have been watching the same lotus pond change colour since I was a child. Dawn is soft yellow. By evening, the water turns a colour I have no name for.

Slide 2 — That pond is where every colour in this collection comes from.

Slide 3 — Soft yellows. Sky blues. Deep maroon. The quiet of ivory. The depth of the night sky. Which one feels like you right now?
(Poll)

Slide 4 — See the full palette.
(CTA: Explore the collection.)


SET 5 — A Letter to Those Who Belong Everywhere

Slide 1 — So many of us left home carrying traditions, languages, memories.

Slide 2 — Pieces of a life that did not fit inside a suitcase.

Slide 3 — My roots are what keep me anchored. Like the tree that is rooted deep in Himachal but reaches everywhere.

Slide 4 — Laya was born from that.
(CTA: Read the full story.)`;

const parsed=parseStorySets(sample);
assert.equal(parsed.sets.length,5);
assert.equal(parsed.totalSlides,17);
assert.equal(parsed.sets[0].slides[0].content_description,'Tina talking video');
assert.equal(parsed.sets[0].slides[0].no_text_overlay,true);
assert.equal(parsed.sets[0].slides[0].caption_cc,true);
assert.equal(parsed.sets[3].slides[2].interaction,'Poll');

const file=(id,name,type)=>({id,filename:name,type,file:new Blob(['x'],{type})});
const mk=count=>Array.from({length:count},(_,i)=>({
  id:`s${i}`,slide_number:i+1,copy:`Exact copy ${i+1}`,overlay_text:`Exact copy ${i+1}`,
  cta:i===count-1?'Shop now':'',interaction:'',direction:'Keep it restrained',art:'Keep it restrained',
  role:i===0?'Opening':i===count-1?'Resolution / CTA':'Development',no_text_overlay:false,caption_cc:false,
  main:file(`m${i}`,`image-${i}.jpg`,'image/jpeg'),reference:file(`r${i}`,`ref-${i}.png`,'image/png')
}));
for(const count of[1,4,7]){
  const set={id:'set-1',title:'Test Set',overallDirection:'Soft and tactile.'},slides=mk(count);
  const one=slidePrompt(slides[0],0,slides,set);
  assert.equal(one.story_set.overall_set_direction,'Soft and tactile.');
  assert.equal(one.approved_set_style_blueprint,undefined);
  assert.equal(parseJson(pretty(one)).ok,true);
  const full=bulkPrompt(slides,set);
  assert.equal(full.slides.length,count);
  assert.equal(full.expected_results.number_of_images,count);
  assert.equal(full.generation_instruction.stop_after_first_slide,false);
  assert.equal(readiness(slides,set).every(r=>r.ready),true);
  assert.equal(storyArc(slides).opening,'Exact copy 1');
}
const incomplete=mk(1);incomplete[0].reference=null;
assert.equal(readiness(incomplete,{id:'x',title:'x'})[0].ready,false);
assert.deepEqual(readiness(incomplete,{id:'x',title:'x'})[0].missing,['design reference']);
assert.equal(slug('The Journey of a Garment'),'the-journey-of-a-garment');
assert.ok(await makeSlideZip(mk(1)[0],0,mk(1),{id:'x',title:'x'}));
assert.ok(await makeZip(mk(2),{id:'x',title:'x'},null,false));
console.log('simplified workflow parser, JSON and ZIP tests passed');
