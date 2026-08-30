"use client";

import { Eye, MoreVertical, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DeleteQuestionDialog } from "@/components/mcq/delete-question-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteQuestionRequest } from "@/lib/mcq-client";

export interface QuestionActionsProps {
  questionId: string;
  questionName: string;
}

export function QuestionActions({
  questionId,
  questionName,
}: QuestionActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setDeleting(true);

    const result = await deleteQuestionRequest(questionId);

    if (!result.ok) {
      // The dialog stays open holding the reason, so the row is never removed from the
      // table on the strength of a request that failed.
      setError(result.formError ?? Object.values(result.fields)[0]);
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${questionName}`}
            />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<Link href={`/mcq/${questionId}/edit`} />}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            render={<Link href={`/mcq/${questionId}/preview`} />}
          >
            <Eye />
            Preview
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteQuestionDialog
        questionName={questionName}
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) {
            setError(null);
          }
        }}
        onConfirm={handleDelete}
        deleting={deleting}
        error={error}
      />
    </>
  );
}
