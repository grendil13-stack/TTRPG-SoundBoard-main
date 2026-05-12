import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  __SUPABASE_URL__,
  __SUPABASE_ANON_KEY__,
);
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY