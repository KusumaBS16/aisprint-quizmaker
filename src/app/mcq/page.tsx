import type { Metadata } from "next";

import { LogoutButton } from "@/components/auth/logout-button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Quiz - QuizMaker",
};

export default function McqPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          {/* <span className="font-semibold">QuizMaker</span> */}
          {/* <Badge variant="secondary">Placeholder</Badge> */}
        </div>
        <LogoutButton />
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            This page is a placeholder.
          </p>
          <p className="mt-1">
            Quiz questions will appear here once quiz storage is implemented.
            Nothing is scored yet, and no answers are saved. This page is also
            reachable without logging in, because Sprint 1 has no session
            management — that is expected here, not a bug.
          </p>
        </div>
      </main>
    </div>
  );
}
