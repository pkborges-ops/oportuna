import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { obterConfigSupabase } from "@/lib/supabase/env";

export async function criarClienteSupabaseServer() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseKey } = obterConfigSupabase();

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components nao gravam cookies; o proxy renova a sessao.
        }
      },
    },
  });
}
