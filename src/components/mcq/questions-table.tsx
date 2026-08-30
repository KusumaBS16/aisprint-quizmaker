import Link from "next/link";

import { QuestionActions } from "@/components/mcq/question-actions";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PublicQuestion } from "@/lib/services/mcq-service";

export interface QuestionsTableProps {
  questions: PublicQuestion[];
}

export function QuestionsTable({ questions }: QuestionsTableProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* The create control sits on the opposite side of the page from the logout button in
          the header, so the two are never mistaken for one another. */}
      <div className="flex justify-start">
        {/* Styled as a button but left as a plain anchor. Wrapping it in Button would either
            warn that the rendered element is not a native button, or relabel a link as
            role="button" - and this navigates, so link is the honest role. */}
        <Link href="/mcq/new" className={buttonVariants()}>
          Create question
        </Link>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28%]">Name</TableHead>
              <TableHead>Question</TableHead>
              <TableHead className="w-16 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {questions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-8 text-center text-muted-foreground"
                >
                  No questions yet. Use the button above to add one.
                </TableCell>
              </TableRow>
            ) : (
              questions.map((question) => (
                <TableRow key={question.id}>
                  <TableCell className="font-medium">{question.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {question.questionText}
                  </TableCell>
                  <TableCell className="text-right">
                    <QuestionActions
                      questionId={question.id}
                      questionName={question.name}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
