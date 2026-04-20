import "server-only";
import { createClient } from "@supabase/supabase-js";

// Client service_role: bypass RLS. À n'utiliser QUE côté serveur, jamais
// exposé au navigateur.
export const createSupabaseAdminClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
