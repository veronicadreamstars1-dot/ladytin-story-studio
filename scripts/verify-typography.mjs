import{readdir,readFile,stat}from'node:fs/promises';
import{extname,join,relative}from'node:path';

const roots=['src','tests','scripts','supabase','dist'];
const ignored=new Set(['node_modules','.git']);
const textExtensions=new Set(['.js','.mjs','.ts','.css','.html','.md','.json','.sql','.txt','.example']);
const forbidden=('aqua'+'lim').toLowerCase();
const fontExtensions=new Set(['.otf','.ttf','.woff','.woff2']);
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
  if(fontExtensions.has(ext))violations.push(`${relative('.',path)}: unexpected font binary`);
  if(!textExtensions.has(ext)&&!path.endsWith('.env.example'))return;
  const text=await readFile(path,'utf8');
  if(text.toLowerCase().includes(forbidden))violations.push(`${relative('.',path)}: removed typeface name remains`);
}

for(const root of roots)await walk(root);
for(const file of['index.html','package.json','vercel.json','.env.example','PINTEREST_REFERENCE_SETUP.md'])await walk(file);
if(violations.length){
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('Typography verification passed: system monospace UI, no removed font references or binaries.');
