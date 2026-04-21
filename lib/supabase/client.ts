import { createBrowserClient } from "@supabase/ssr";
import { sharedCookieOptions } from "./cookie-options";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export const createSupabaseBrowserClient = () => {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookieOptions: sharedCookieOptions },
    );
  }
  return browserClient;
};
