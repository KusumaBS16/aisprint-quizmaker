import type { Metadata } from "next";

import { QuestionsTable } from "@/components/mcq/questions-table";
import { listQuestions } from "@/lib/services/mcq-service";

export const metadata: Metadata = {
  title: "Questions - QuizMaker",
};

// The page reads D1 on every request, so there is nothing to prerender at build time.
export const dynamic = "force-dynamic";

export default async function McqPage() {
  // A Server Component calling the service directly. The API routes exist for the browser;
  // going back out over HTTP from the server to reach the same function would only add a
  // round trip. Either way, D1 is reached through the service and nowhere else.
  const questions = await listQuestions();

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Multiple-choice questions</h1>
        <p className="text-sm text-muted-foreground">
          Every question in the database. Questions are not filtered by teacher,
          because there is no session layer yet.
        </p>
      </div>

      <QuestionsTable questions={questions} />
    </>
  );
}
