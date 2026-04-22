import { createBrowserClient } from "@supabase/ssr";
import { cookieConfigForHost } from "./cookie-domain";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export const createSupabaseBrowserClient = () => {
  if (!browserClient) {
    const host =
      typeof window !== "undefined" ? window.location.hostname : undefined;
    const cookieOptions = cookieConfigForHost(host);
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookieOptions },
    );
  }
  return browserClient;
};
