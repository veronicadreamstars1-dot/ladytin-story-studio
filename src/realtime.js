// Realtime subscriptions and Presence for the currently open project only.
import{supabase}from'./supabase.js';
import{seenRevisions}from'./cloud.js';
import{shouldApplyEvent}from'./db.js';
import{buildPresencePayload,flattenPresenceState,getPresenceClientId,makePresenceKey}from'./presence.js';

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
  dataChannel=ch.subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Realtime data channel status:',status)});
  return dataChannel;
}
export function unsubscribeData(){if(dataChannel){supabase.removeChannel(dataChannel);dataChannel=null}}

const clientId=getPresenceClientId();
let lastPresence={},presenceSubscribed=false,presenceSync=null;

async function trackPresence(){
  if(!presenceChannel||!presenceSubscribed)return;
  try{await presenceChannel.track(buildPresencePayload(lastPresence))}
  catch(error){console.warn('Presence track failed:',error)}
}

export function joinPresence(projectId,me,onSync){
  leavePresence();
  lastPresence={...me,client_id:clientId};
  presenceSync=onSync;
  presenceChannel=supabase.channel(`project-presence:${projectId}`,{config:{presence:{key:makePresenceKey(me.user_id,clientId)}}});
  presenceChannel.on('presence',{event:'sync'},()=>{
    const list=flattenPresenceState(presenceChannel?.presenceState?.()||{});
    presenceSync?.(list);
  });
  presenceChannel.on('presence',{event:'join'},()=>presenceSync?.(flattenPresenceState(presenceChannel?.presenceState?.()||{})));
  presenceChannel.on('presence',{event:'leave'},()=>presenceSync?.(flattenPresenceState(presenceChannel?.presenceState?.()||{})));
  presenceChannel.subscribe(async status=>{
    if(status==='SUBSCRIBED'){
      presenceSubscribed=true;
      await trackPresence();
    }else if(status==='CLOSED'){
      presenceSubscribed=false;
    }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
      presenceSubscribed=false;
      console.warn('Presence channel status:',status);
    }
  });
  return presenceChannel;
}

export async function updatePresence(patch){
  lastPresence={...lastPresence,...patch,client_id:clientId};
  await trackPresence();
}

export function leavePresence(){
  const channel=presenceChannel;
  presenceChannel=null;
  presenceSubscribed=false;
  presenceSync=null;
  lastPresence={};
  if(channel){
    try{void channel.untrack?.()}catch{}
    supabase.removeChannel(channel);
  }
}
export function unsubscribeAll(){unsubscribeData();leavePresence()}
