import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://kquiougzmjxtaneeedip.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxdWlvdWd6bWp4dGFuZWVlZGlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MTg2MzEsImV4cCI6MjA5Mzk5NDYzMX0.HKp-KHbI4QCuyFL0lEjaMf2FHM3fQoc7CyzW9BTQbzM";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);