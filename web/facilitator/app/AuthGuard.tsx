"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isLocalDev, getCurrentSession } from "@/lib/auth";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      if (pathname.startsWith("/auth/")) return;
      if (isLocalDev()) return;

      const session = await getCurrentSession();
      if (!session) {
        router.replace("/auth/signin");
      }
    };

    checkAuth();
  }, [pathname, router]);

  return <>{children}</>;
}
