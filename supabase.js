import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://kquiougzmjxtaneeedip.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);