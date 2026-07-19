import{createClient}from'@supabase/supabase-js';
import{SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,isConfigured}from'./config.js';

// One browser client for the whole app. Only the publishable key is ever used here.
export const supabase=isConfigured()?createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export{isConfigured,missingConfig}from'./config.js';
