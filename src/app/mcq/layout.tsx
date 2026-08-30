import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";

// The logout control lives here, alone in the header bar. Page content starts below the
// border, which is what keeps it from crowding the create button on the list page.
export default function McqLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/mcq" className="font-semibold">
          QuizMaker
        </Link>
        <LogoutButton />
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        {children}
      </main>
    </div>
  );
}
