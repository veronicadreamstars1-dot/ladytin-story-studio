// Browser-safe configuration. Values are injected at build time by scripts/build.mjs
// (esbuild define). A runtime override via window.__LADYTIN_CONFIG__ is supported for
// local experiments. Missing configuration must produce a readable setup state, never
// an uncaught exception.
const injected = {
  url: typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '',
  key: typeof __SUPABASE_PUBLISHABLE_KEY__ !== 'undefined' ? __SUPABASE_PUBLISHABLE_KEY__ : '',
};
const runtime = (typeof window !== 'undefined' && window.__LADYTIN_CONFIG__) || {};

export const SUPABASE_URL = String(runtime.SUPABASE_URL || injected.url || '');
export const SUPABASE_PUBLISHABLE_KEY = String(runtime.SUPABASE_PUBLISHABLE_KEY || injected.key || '');
export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const missingConfig = () => [
  ...(SUPABASE_URL ? [] : ['SUPABASE_URL']),
  ...(SUPABASE_PUBLISHABLE_KEY ? [] : ['SUPABASE_PUBLISHABLE_KEY']),
];
