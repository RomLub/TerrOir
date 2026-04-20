"use client";

import { useUserContext } from "@/components/providers/user-provider";

export function useUser() {
  return useUserContext();
}
