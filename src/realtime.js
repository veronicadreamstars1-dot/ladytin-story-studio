// Realtime subscriptions and Presence for the currently open project only.
import{supabase}from'./supabase.js';
import{seenRevisions}from'./cloud.js';
import{shouldApplyEvent}from'./db.js';
import{buildPresencePayload,flattenPresenceState,getPresenceClientId,makePresenceKey}from'./presence.js';

let dataChannel=null,presenceChannel=null;
let dataGeneration=0,presenceGeneration=0;

export function subscribeToProject(projectId,storySetIds,onEvent){
  unsubscribeData();
  const generation=++dataGeneration;
  const forward=table=>payload=>{
    if(generation!==dataGeneration)return;
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
  dataChannel=ch;
  ch.subscribe(status=>{
    if(generation!==dataGeneration||dataChannel!==ch)return;
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Realtime data channel status:',status);
  });
  return ch;
}
export function unsubscribeData(){
  dataGeneration++;
  const channel=dataChannel;
  dataChannel=null;
  if(channel)void supabase.removeChannel(channel);
}

const clientId=getPresenceClientId();
let lastPresence={},presenceSubscribed=false,presenceSync=null;

async function trackPresence(channel=presenceChannel,generation=presenceGeneration){
  if(!channel||channel!==presenceChannel||generation!==presenceGeneration||!presenceSubscribed)return false;
  try{
    const result=await channel.track(buildPresencePayload(lastPresence));
    return result==='ok'||result===undefined;
  }catch(error){
    if(channel===presenceChannel&&generation===presenceGeneration)console.warn('Presence track failed:',error);
    return false;
  }
}

function syncPresence(channel,generation){
  if(channel!==presenceChannel||generation!==presenceGeneration)return;
  const list=flattenPresenceState(channel.presenceState?.()||{});
  presenceSync?.(list);
}

export function joinPresence(projectId,me,onSync){
  leavePresence();
  const generation=++presenceGeneration;
  lastPresence={...me,client_id:clientId};
  presenceSync=onSync;
  const channel=supabase.channel(`project-presence:${projectId}`,{config:{presence:{key:makePresenceKey(me.user_id,clientId)}}});
  presenceChannel=channel;
  channel.on('presence',{event:'sync'},()=>syncPresence(channel,generation));
  channel.on('presence',{event:'join'},()=>syncPresence(channel,generation));
  channel.on('presence',{event:'leave'},()=>syncPresence(channel,generation));
  channel.subscribe(async status=>{
    if(channel!==presenceChannel||generation!==presenceGeneration)return;
    if(status==='SUBSCRIBED'){
      presenceSubscribed=true;
      await trackPresence(channel,generation);
      syncPresence(channel,generation);
    }else if(status==='CLOSED'){
      presenceSubscribed=false;
    }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
      presenceSubscribed=false;
      console.warn('Presence channel status:',status);
    }
  });
  return channel;
}

export async function updatePresence(patch){
  lastPresence={...lastPresence,...patch,client_id:clientId};
  return trackPresence();
}

export function leavePresence(){
  const channel=presenceChannel;
  presenceGeneration++;
  presenceChannel=null;
  presenceSubscribed=false;
  presenceSync=null;
  lastPresence={};
  if(channel){
    try{void channel.untrack?.()}catch{}
    void supabase.removeChannel(channel);
  }
}
export function unsubscribeAll(){unsubscribeData();leavePresence()}
