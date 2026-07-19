// Realtime subscriptions and Presence for the currently open project only.
import{supabase}from'./supabase.js';
import{seenRevisions}from'./cloud.js';
import{shouldApplyEvent}from'./db.js';

let dataChannel=null,presenceChannel=null;

export function subscribeToProject(projectId,storySetIds,onEvent){
  unsubscribeData();
  const forward=table=>payload=>{
    const row=payload.new&&Object.keys(payload.new).length?payload.new:null;
    const old=payload.old&&Object.keys(payload.old).length?payload.old:null;
    if(payload.eventType!=='DELETE'&&!shouldApplyEvent(seenRevisions,table,row))return;
    onEvent({table,type:payload.eventType,row:row||{},old:old||{}});
  };
  let ch=supabase.channel(`project-data:${projectId}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'projects',filter:`id=eq.${projectId}`},forward('projects'))
    .on('postgres_changes',{event:'*',schema:'public',table:'story_sets',filter:`project_id=eq.${projectId}`},forward('story_sets'))
    .on('postgres_changes',{event:'*',schema:'public',table:'assets',filter:`project_id=eq.${projectId}`},forward('assets'))
    .on('postgres_changes',{event:'*',schema:'public',table:'project_members',filter:`project_id=eq.${projectId}`},forward('project_members'))
    .on('postgres_changes',{event:'*',schema:'public',table:'pinterest_pins',filter:`project_id=eq.${projectId}`},forward('pinterest_pins'));
  if(storySetIds.length)ch=ch.on('postgres_changes',{event:'*',schema:'public',table:'slides',filter:`story_set_id=in.(${storySetIds.join(',')})`},forward('slides'));
  dataChannel=ch.subscribe();
  return dataChannel;
}
export function unsubscribeData(){if(dataChannel){supabase.removeChannel(dataChannel);dataChannel=null}}

let lastPresence={};
export function joinPresence(projectId,me,onSync){
  leavePresence();
  lastPresence={...me};
  presenceChannel=supabase.channel(`project-presence:${projectId}`,{config:{presence:{key:me.user_id}}});
  presenceChannel.on('presence',{event:'sync'},()=>{
    const state=presenceChannel.presenceState();
    onSync(Object.values(state).map(entries=>entries[0]).filter(Boolean));
  });
  presenceChannel.subscribe(async status=>{
    if(status==='SUBSCRIBED')await presenceChannel.track({...lastPresence,last_active:new Date().toISOString()});
  });
  return presenceChannel;
}
export async function updatePresence(patch){
  if(!presenceChannel)return;
  lastPresence={...lastPresence,...patch};
  try{await presenceChannel.track({...lastPresence,last_active:new Date().toISOString()})}catch{}
}
export function leavePresence(){if(presenceChannel){supabase.removeChannel(presenceChannel);presenceChannel=null}}
export function unsubscribeAll(){unsubscribeData();leavePresence()}
