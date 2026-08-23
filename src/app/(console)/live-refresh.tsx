"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource("/api/events");
    const onMutate = () => router.refresh();
    source.addEventListener("mutate", onMutate);
    return () => {
      source.removeEventListener("mutate", onMutate);
      source.close();
    };
  }, [router]);
  return null;
}
