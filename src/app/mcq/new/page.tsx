import type { Metadata } from "next";

import { McqForm } from "@/components/mcq/mcq-form";

export const metadata: Metadata = {
  title: "New question - QuizMaker",
};

export default function NewQuestionPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">New question</h1>
        <p className="text-sm text-muted-foreground">
          Write the question, then give it between two and six choices.
        </p>
      </div>

      <McqForm />
    </>
  );
}
