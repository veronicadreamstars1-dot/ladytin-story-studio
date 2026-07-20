export const DRIVE_STATUS={
  unconfigured:'unconfigured',
  disconnected:'disconnected',
  connected:'connected',
  syncing:'syncing',
  error:'error'
};

export const DRIVE_SCOPES=[
  'https://www.googleapis.com/auth/drive.file'
];

const SUPPORTED_EXTENSIONS=new Set(['jpg','jpeg','png','webp','gif','heic','svg','pdf','mp4','mov','m4v']);
const NATIVE_GOOGLE_TYPES=new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
  'application/vnd.google-apps.folder'
]);

export function isDriveConfigured(env={}){
  return Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_REDIRECT_URI);
}

export function driveSetupRequirements(){
  return{
    status:DRIVE_STATUS.unconfigured,
    message:'Google Drive is not configured yet.',
    scopes:DRIVE_SCOPES,
    folder_structure:['LadyTin Story Studio/Reference Library/Collections','LadyTin Story Studio/Reference Library/Unsorted','LadyTin Story Studio/Media Asset Library/Collections','LadyTin Story Studio/Media Asset Library/Unsorted']
  };
}

export function classifyDriveFile(file={}){
  const name=String(file.name||file.original_filename||'');
  const ext=name.includes('.')?name.split('.').pop().toLowerCase():'';
  const mime=String(file.mimeType||file.mime_type||'application/octet-stream');
  if(NATIVE_GOOGLE_TYPES.has(mime))return{supported:false,reason:'Native Google files are not image, video or PDF binaries.',extension:ext,mime_type:mime};
  if(SUPPORTED_EXTENSIONS.has(ext)||/^image\/|^video\/|application\/pdf|image\/svg\+xml/.test(mime))return{supported:true,reason:'Supported library source file.',extension:ext,mime_type:mime};
  return{supported:false,reason:'Unsupported file type for LadyTin generation libraries.',extension:ext,mime_type:mime};
}

export function normaliseDriveFile(file={},libraryType='reference'){
  const support=classifyDriveFile(file);
  return{
    id:String(file.id||''),
    library_type:libraryType,
    title:String(file.name||'Untitled file'),
    original_filename:String(file.name||'file'),
    mime_type:support.mime_type,
    byte_size:Number(file.size)||0,
    source_type:'google_drive',
    google_drive_file_id:String(file.id||''),
    google_drive_parent_id:Array.isArray(file.parents)?file.parents[0]||'':file.google_drive_parent_id||'',
    google_drive_web_view_link:String(file.webViewLink||file.google_drive_web_view_link||''),
    google_drive_modified_at:file.modifiedTime||file.google_drive_modified_at||null,
    media_category:support.extension==='pdf'?'PDF':support.mime_type.startsWith('video/')?'video':support.mime_type.includes('svg')?'SVG':'image',
    sync_supported:support.supported,
    sync_error:support.supported?'':support.reason
  };
}

export function mergeDriveSync(existingItems=[],driveFiles=[],libraryType='reference',now=new Date().toISOString()){
  const byDriveId=new Map(existingItems.filter(item=>item.google_drive_file_id).map(item=>[item.google_drive_file_id,item]));
  const seen=new Set(),added=[],changed=[],unsupported=[];
  for(const file of driveFiles){
    const normalised=normaliseDriveFile(file,libraryType);
    if(!normalised.sync_supported){unsupported.push(normalised);continue}
    seen.add(normalised.google_drive_file_id);
    const previous=byDriveId.get(normalised.google_drive_file_id);
    if(!previous){added.push({...normalised,created_at:now,updated_at:now});continue}
    const renamed=previous.original_filename!==normalised.original_filename;
    const moved=previous.google_drive_parent_id!==normalised.google_drive_parent_id;
    const modified=String(previous.google_drive_modified_at||'')!==String(normalised.google_drive_modified_at||'');
    if(renamed||moved||modified)changed.push({...previous,...normalised,updated_at:now,archived_at:null});
  }
  const archived=existingItems.filter(item=>item.source_type==='google_drive'&&item.library_type===libraryType&&item.google_drive_file_id&&!seen.has(item.google_drive_file_id)&&!item.archived_at).map(item=>({...item,archived_at:now,updated_at:now}));
  return{added,changed,archived,unsupported,summary:{files_added:added.length,files_changed:changed.length,files_archived:archived.length,errors:unsupported.length}};
}
