const STORAGE_KEY='ladytin-presence-client-id';

function fallbackId(){
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}

export function getPresenceClientId(storage=globalThis.sessionStorage,randomUUID=globalThis.crypto?.randomUUID?.bind(globalThis.crypto)){
  let existing='';
  try{existing=storage?.getItem(STORAGE_KEY)||''}catch{}
  if(existing)return existing;
  const created=typeof randomUUID==='function'?randomUUID():fallbackId();
  try{storage?.setItem(STORAGE_KEY,created)}catch{}
  return created;
}

export function makePresenceKey(userId,clientId){
  return `${String(userId||'anonymous')}:${String(clientId||'client')}`;
}

export function flattenPresenceState(state={}){
  return Object.values(state)
    .flatMap(entries=>Array.isArray(entries)?entries:[])
    .filter(Boolean)
    .sort((a,b)=>String(a.name||a.user_id||'').localeCompare(String(b.name||b.user_id||''))||String(a.client_id||'').localeCompare(String(b.client_id||'')));
}

export function buildPresencePayload(base={},patch={}){
  return {...base,...patch,last_active:new Date().toISOString()};
}
