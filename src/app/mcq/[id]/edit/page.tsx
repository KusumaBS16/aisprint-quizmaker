import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { McqForm } from "@/components/mcq/mcq-form";
import { findQuestionForEditing } from "@/lib/services/mcq-service";

export const metadata: Metadata = {
  title: "Edit question - QuizMaker",
};

export const dynamic = "force-dynamic";

interface EditQuestionPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditQuestionPage({
  params,
}: EditQuestionPageProps) {
  const { id } = await params;

  // findQuestionForEditing is the one read that carries the answer key, and it has no HTTP
  // route. It is reachable only from a Server Component like this one, so the key is rendered
  // into the form's initial state rather than served to anyone who asks for it.
  const question = await findQuestionForEditing(id);
  if (!question) {
    notFound();
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Edit question</h1>
        <p className="text-sm text-muted-foreground">{question.name}</p>
      </div>

      <McqForm
        questionId={question.id}
        initial={{
          name: question.name,
          questionText: question.questionText,
          choices: question.choices,
        }}
      />
    </>
  );
}
