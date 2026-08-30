import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewForm } from "@/components/mcq/preview-form";
import { findQuestionById } from "@/lib/services/mcq-service";

export const metadata: Metadata = {
  title: "Preview question - QuizMaker",
};

export const dynamic = "force-dynamic";

interface PreviewQuestionPageProps {
  params: Promise<{ id: string }>;
}

export default async function PreviewQuestionPage({
  params,
}: PreviewQuestionPageProps) {
  const { id } = await params;

  // findQuestionById returns PublicChoice values only, so the answer key is not in this
  // page's HTML and the teacher's own browser cannot read it before answering.
  const question = await findQuestionById(id);
  if (!question) {
    notFound();
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{question.name}</h1>
        <p className="text-sm text-muted-foreground">
          Answer this the way a student would.
        </p>
      </div>

      <PreviewForm
        questionId={question.id}
        questionText={question.questionText}
        choices={question.choices}
      />
    </>
  );
}
