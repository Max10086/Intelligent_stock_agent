/** Public Supabase settings safe to expose to the browser (anon/publishable key only). */
export function getPublicSupabaseConfig(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
} {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '';

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';

  return { supabaseUrl, supabaseAnonKey };
}
