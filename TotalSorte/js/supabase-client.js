import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const config = window.TOTALSORTE_SUPABASE_CONFIG || {};
const configured = typeof config.url === "string" &&
  config.url.startsWith("https://") &&
  typeof config.anonKey === "string" &&
  config.anonKey.length > 20 &&
  !config.url.includes("COLE_AQUI") &&
  !config.anonKey.includes("COLE_AQUI");

if (configured) {
  window.totalSorteSupabase = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.dispatchEvent(new CustomEvent("totalsorte:supabase-ready"));
  console.info("TotalSorte: cliente Supabase inicializado.");
} else {
  window.totalSorteSupabase = null;
  console.info("TotalSorte: Supabase ainda não configurado. A demonstração local permanece disponível.");
}
