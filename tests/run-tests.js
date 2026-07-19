import assert from'node:assert/strict';
import{bulkPrompt,emptyBlueprint,pretty,readiness,slidePrompt,slug}from'../src/prompting.js';
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
const parsed=parseStorySets(sample);assert.equal(parsed.sets.length,5);assert.equal(parsed.totalSlides,17);assert.equal(parsed.sets[0].slides[0].content_description,'Tina talking video');assert.equal(parsed.sets[0].slides[0].overlay_text,'');assert.equal(parsed.sets[0].slides[0].no_text_overlay,true);assert.equal(parsed.sets[0].slides[0].caption_cc,true);assert.equal(parsed.sets[0].slides[1].cta,'Discover Laya.');assert.equal(parsed.sets[1].slides[3].cta,'See where it begins.');assert.equal(parsed.sets[3].slides[2].interaction,'Poll');assert.equal(parsed.sets[3].slides[3].cta,'Explore the collection.');assert.equal(parsed.sets[4].slides[0].overlay_text,'So many of us left home carrying traditions, languages, memories.');
const variants=parseStorySets('STORY SET 1: नमस्ते लाया\n\nS1 - यह कॉपी जस की तस रहनी चाहिए।\n(Question box)');assert.equal(variants.sets[0].title,'नमस्ते लाया');assert.equal(variants.sets[0].slides[0].overlay_text,'यह कॉपी जस की तस रहनी चाहिए।');assert.equal(variants.sets[0].slides[0].interaction,'Question');
const noMarkers=parseStorySets('Untitled thought\nA paragraph with no slide marker.');assert.equal(noMarkers.sets[0].slides.length,1);assert.ok(noMarkers.sets[0].parseWarnings.includes('No explicit slide markers were found.'));
const duplicates=parseStorySets('SET 1 — Duplicate\nSlide 2 — A\nSlide 2 — B');assert.ok(duplicates.sets[0].parseWarnings.some(x=>x.includes('Two Slide 2')));
for(const c of[1,4,5]){const slides=Array.from({length:c},(_,i)=>({overlay_text:`Copy ${i+1}`,cta:'',interaction:'',direction:'Direction',role:i?'Development':'Opening',main:{id:`m${i}`,filename:`image-${i}.jpg`,type:'image/jpeg'},reference:{id:`r${i}`,filename:`ref-${i}.png`,type:'image/png'}})),bp=emptyBlueprint('Set',c);bp.approval.status='approved';assert.equal(JSON.parse(pretty(slidePrompt(slides[0],0,slides,bp))).exact_copy.overlay_text,'Copy 1');const full=JSON.parse(pretty(bulkPrompt(slides,bp)));assert.equal(full.slides.length,c);assert.equal(full.expected_results.number_of_images,c);assert.equal(readiness(slides,bp).every(x=>x.ready),true)}
assert.equal(slug('The Journey of a Garment'),'the-journey-of-a-garment');
console.log('parser and prompt JSON tests passed');
