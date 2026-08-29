"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // There is no session, token, or cookie to invalidate, so a failed call has changed
      // nothing. The redirect is what logging out means in this sprint, so it happens anyway.
    }

    router.push("/login");
  }

  return (
    <Button variant="outline" onClick={handleLogout} disabled={pending}>
      {pending ? "Signing out..." : "Log out"}
    </Button>
  );
}
