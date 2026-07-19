export function inviteTokenFromPath(pathname=''){
  const match=String(pathname).match(/^\/invite\/([^/?#]+)/i);
  if(!match)return'';
  try{return decodeURIComponent(match[1])}catch{return match[1]}
}

export function normaliseInitialRoute(win=globalThis.window){
  if(!win?.location||!win?.history)return null;
  const token=inviteTokenFromPath(win.location.pathname);
  if(!token)return null;
  const url=new URL(win.location.href);
  url.pathname='/';
  url.searchParams.set('invite',token);
  win.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
  return token;
}

if(typeof window!=='undefined')normaliseInitialRoute(window);
