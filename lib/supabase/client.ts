import { createBrowserClient } from "@supabase/ssr";

import { obterConfigSupabase } from "@/lib/supabase/env";

export function criarClienteSupabaseBrowser() {
  const { supabaseUrl, supabaseKey } = obterConfigSupabase();

  return createBrowserClient(supabaseUrl, supabaseKey);
}
