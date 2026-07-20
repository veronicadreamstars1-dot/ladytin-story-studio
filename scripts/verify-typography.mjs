import{readdir,readFile,stat}from'node:fs/promises';
import{extname,join,relative}from'node:path';

const roots=['src','tests','scripts','dist'];
const explicitFiles=['index.html','package.json','vercel.json','.env.example','README.md','SUPABASE_DEPLOYMENT.md','supabase/functions/shared-access/index.ts'];
const ignored=new Set(['node_modules','.git']);
const textExtensions=new Set(['.js','.mjs','.ts','.css','.html','.md','.json','.sql','.txt','.example']);
const removedTypeface=('aqua'+'lim').toLowerCase();
const rawPassword=String.fromCharCode(100,117,109,100,117,109);
const fontExtensions=new Set(['.otf','.ttf','.woff','.woff2']);
const forbiddenAuthPatterns=[/signInWithOtp/i,/verifyOtp/i,/generateLink/i,/SHARED_EMAIL/i,/authEmail/i,/inviteEmail/i,/shared-access@/i,/collaborator@/i];
const forbiddenLibraryPatterns=[/PINTEREST_/i,/pin\.it/i,/boards:read/i,/pins:read/i,/pinterest_auto/i,/pinterest_selected/i,/Connect Pinterest/i,/Sync Pinterest/i];
const forbiddenDrivePatterns=[/GOOGLE_CLIENT_ID/i,/GOOGLE_CLIENT_SECRET/i,/GOOGLE_REDIRECT_URI/i,/GOOGLE_OAUTH_STATE_SECRET/i,/GOOGLE_TOKEN_ENCRYPTION_KEY/i,/google_drive_/i,/Google Drive/i,/Connect Google/i,/Sync Libraries/i,/drive\.google/i,/googleapis\.com\/auth\/drive/i];
const violations=[];

async function walk(path){
  let info;
  try{info=await stat(path)}catch{return}
  if(info.isDirectory()){
    if(ignored.has(path.split('/').at(-1)))return;
    for(const entry of await readdir(path))await walk(join(path,entry));
    return;
  }
  const ext=extname(path).toLowerCase();
  const rel=relative('.',path);
  if(fontExtensions.has(ext))violations.push(`${rel}: unexpected font binary`);
  if(!textExtensions.has(ext)&&!path.endsWith('.env.example'))return;
  const text=await readFile(path,'utf8');
  const isVerifier=rel==='scripts/verify-typography.mjs';
  if(text.toLowerCase().includes(removedTypeface))violations.push(`${rel}: removed typeface name remains`);
  if(text.includes(rawPassword))violations.push(`${rel}: raw application password is present`);
  if(!rel.startsWith('tests')&&!rel.startsWith('dist')&&!isVerifier)for(const pattern of forbiddenAuthPatterns)if(pattern.test(text))violations.push(`${rel}: removed email-auth mechanism remains (${pattern})`);
  if(!rel.startsWith('tests')&&!isVerifier)for(const pattern of forbiddenLibraryPatterns)if(pattern.test(text))violations.push(`${rel}: removed reference-board mechanism remains (${pattern})`);
  if(!rel.startsWith('tests')&&!rel.startsWith('supabase/migrations')&&!isVerifier)for(const pattern of forbiddenDrivePatterns)if(pattern.test(text))violations.push(`${rel}: removed Drive integration remains (${pattern})`);
  if(rel.startsWith(`dist${process.platform==='win32'?'\\':'/'}`)&&/SUPABASE_SERVICE_ROLE_KEY|GOOGLE_CLIENT_SECRET|GOOGLE_TOKEN_ENCRYPTION_KEY|APP_ACCESS_PASSWORD/i.test(text))violations.push(`${rel}: server-only secret identifier is present in the frontend build`);
}

for(const root of roots)await walk(root);
for(const file of explicitFiles)await walk(file);
try{
  const envExample=await readFile('.env.example','utf8');
  const match=envExample.match(/^APP_ACCESS_PASSWORD=(.*)$/m);
  if(!match||match[1].trim())violations.push('.env.example: APP_ACCESS_PASSWORD must exist with an empty value');
}catch{violations.push('.env.example: missing')}

if(violations.length){console.error(violations.join('\n'));process.exit(1)}
console.log('Security and typography verification passed: monospace UI, password-only anonymous access, Supabase-only shared libraries, no raw password, email-auth code, Drive code, removed board code, font binary or server-secret leakage.');
