export const SHARED_ACCESS_CLAIM='ladytin_shared_access';
export const SHARED_ACCESS_EXPIRY_CLAIM='ladytin_shared_access_expires_at';

export function sharedSessionExpiry(user){
  const raw=user?.app_metadata?.[SHARED_ACCESS_EXPIRY_CLAIM];
  const value=raw?new Date(raw).getTime():0;
  return Number.isFinite(value)?value:0;
}

export function isValidSharedUser(user,now=Date.now()){
  return user?.is_anonymous===true&&user?.app_metadata?.[SHARED_ACCESS_CLAIM]===true&&sharedSessionExpiry(user)>now;
}

export function sharedLoginError(status,body={}){
  if(status===429)return body.error||'Too many incorrect attempts. Try again later.';
  if(status===401)return body.error||'Incorrect password.';
  return body.error||'Could not enter LadyTin Story Studio.';
}

export function sharedLoginPayload(password){
  return{password:String(password||'')};
}
