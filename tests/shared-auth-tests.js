import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{isValidSharedUser,sharedLoginError,sharedLoginPayload,sharedSessionExpiry}from'../src/shared-auth-core.js';

const now=Date.now();
const valid={is_anonymous:true,app_metadata:{ladytin_shared_access:true,ladytin_shared_access_expires_at:new Date(now+60_000).toISOString()}};
const expired={is_anonymous:true,app_metadata:{ladytin_shared_access:true,ladytin_shared_access_expires_at:new Date(now-1).toISOString()}};
assert.equal(isValidSharedUser(valid,now),true);
assert.equal(isValidSharedUser(expired,now),false);
assert.equal(isValidSharedUser({...valid,is_anonymous:false},now),false);
assert.equal(isValidSharedUser({is_anonymous:true,app_metadata:{}},now),false);
assert.ok(sharedSessionExpiry(valid)>now);
assert.equal(sharedLoginError(401,{}),'Incorrect password.');
assert.match(sharedLoginError(429,{}),/Too many/);
assert.deepEqual(sharedLoginPayload('secret'),{password:'secret'});

const [index,bootstrap,main,app,cloud,db,library,packageJson,readme,supabaseDoc,edge,envExample,verifierMigration,ticketMigration]=await Promise.all([
  readFile('index.html','utf8'),
  readFile('src/shared-auth-bootstrap.js','utf8'),
  readFile('src/main.js','utf8'),
  readFile('src/app.js','utf8'),
  readFile('src/cloud.js','utf8'),
  readFile('src/db.js','utf8'),
  readFile('src/library.js','utf8'),
  readFile('package.json','utf8'),
  readFile('README.md','utf8'),
  readFile('SUPABASE_DEPLOYMENT.md','utf8'),
  readFile('supabase/functions/shared-access/index.ts','utf8'),
  readFile('.env.example','utf8'),
  readFile('supabase/migrations/20260719194000_shared_password_verifier.sql','utf8'),
  readFile('supabase/migrations/20260719195000_anonymous_shared_access_tickets.sql','utf8'),
]);

assert.match(index,/src\/main\.js/);
assert.doesNotMatch(index,/password-access|src\/app\.js|zip-ui\.js/);
assert.match(main,/ensureSharedSession\(\).*import\('\.\/app\.js'\)/s);
assert.match(bootstrap,/type=\"password\"/);
assert.match(bootstrap,/>Enter</);
assert.match(bootstrap,/signInAnonymously/);
assert.match(bootstrap,/action:'verify'/);
assert.match(bootstrap,/action:'activate'/);
assert.match(bootstrap,/refreshSession/);
assert.doesNotMatch(bootstrap,/signInWithOtp|verifyOtp|generateLink|type=\"email\"|authEmail|magic link/i);
assert.doesNotMatch(app,/authEmail|sendLink|magic link|Invite by email|inviteEmail|shareProject|viewer access/i);
assert.doesNotMatch(cloud,/sendMagicLink|signInWithOtp|createInvite|acceptInvite|listInvites|invited_email|user\.email/i);
assert.match(edge,/create_app_access_ticket/);
assert.match(edge,/consume_app_access_ticket/);
assert.match(edge,/is_anonymous/);
assert.match(edge,/admin\.auth\.getUser/);
assert.doesNotMatch(edge,/generateLink|SHARED_EMAIL|email_confirm|grant_type=password|console\.(log|info|debug)/i);
assert.match(verifierMigration,/revoke all on function public\.verify_app_access_password\(text\) from public, anon, authenticated/i);
assert.match(ticketMigration,/revoke all on function public\.consume_app_access_ticket\(text\) from public, anon, authenticated/i);
assert.match(envExample,/^APP_ACCESS_PASSWORD=$/m);

const activeTexts={app,cloud,db,library,packageJson,readme,supabaseDoc,envExample};
const forbiddenDrive=[
  /Google Drive/i,
  /Connect Google/i,
  /Sync Libraries/i,
  /GOOGLE_CLIENT_ID/,
  /GOOGLE_CLIENT_SECRET/,
  /GOOGLE_REDIRECT_URI/,
  /GOOGLE_OAUTH_STATE_SECRET/,
  /GOOGLE_TOKEN_ENCRYPTION_KEY/,
  /google_drive_/,
  /googleapis\.com\/auth\/drive/,
  /src\/google-drive\.js/
];
for(const[name,text]of Object.entries(activeTexts)){
  for(const pattern of forbiddenDrive)assert.doesNotMatch(text,pattern,`${name} must not contain removed Drive integration text: ${pattern}`);
}
assert.doesNotMatch(app,/drive-panel|connectDrive|syncDrive|Open in Google Drive|Copy Drive link/i);
assert.match(app,/Upload to Media Library/);
assert.match(app,/Upload to Reference Library/);
assert.match(app,/Media Asset Library/);
assert.match(app,/Reference Library/);

const rawPassword=String.fromCharCode(100,117,109,100,117,109);
for(const[name,text]of Object.entries({index,bootstrap,main,app,cloud,db,library,edge,envExample,verifierMigration,ticketMigration}))assert.equal(text.includes(rawPassword),false,`${name} must not contain the raw password`);

console.log('Password-only anonymous access, session expiry, rate-limit wiring, email-auth removal and Drive removal tests passed');
