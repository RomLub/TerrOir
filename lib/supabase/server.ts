import { cookies, headers } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookieConfigForHost } from "./cookie-domain";

export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies();
  const host = (await headers()).get("host") ?? undefined;
  const cookieOptions = cookieConfigForHost(host);

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll may be called from a Server Component where cookies
            // are read-only. Safe to ignore when middleware refreshes the
            // session on subsequent requests.
          }
        },
      },
    },
  );
};
