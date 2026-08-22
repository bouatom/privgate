"use client";

import { createContext, useContext } from "react";
import type { AdminSession } from "@/lib/auth";

export const SessionContext = createContext<AdminSession | null>(null);

export function useSession() {
  return useContext(SessionContext);
}
