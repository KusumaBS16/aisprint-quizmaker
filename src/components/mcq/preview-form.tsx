"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { PublicChoice } from "@/lib/services/mcq-service";
import { submitAttemptRequest } from "@/lib/mcq-client";

export interface PreviewFormProps {
  questionId: string;
  questionText: string;
  choices: PublicChoice[];
}

export function PreviewForm({
  questionId,
  questionText,
  choices,
}: PreviewFormProps) {
  const [selected, setSelected] = useState<string | null>(null);
  // Null until the server has ruled. This component is never told which choice is correct,
  // so it has nothing to display until it is answered.
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null) {
      return;
    }

    setError(null);
    setSubmitting(true);

    const result = await submitAttemptRequest(questionId, selected);

    if (!result.ok) {
      setError(result.formError ?? Object.values(result.fields)[0]);
      setSubmitting(false);
      return;
    }

    setVerdict(result.data.attempt.isCorrect);
    setSubmitting(false);
  }

  function tryAgain() {
    setSelected(null);
    setVerdict(null);
    setError(null);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <p className="text-lg">{questionText}</p>

      <RadioGroup
        value={selected}
        onValueChange={(value) => setSelected(String(value))}
      >
        {choices.map((choice) => (
          <FieldLabel
            key={choice.id}
            className="w-full flex-row items-center gap-3 rounded-lg border p-3 font-normal"
          >
            <RadioGroupItem value={choice.id} aria-label={choice.text} />
            <span>{choice.text}</span>
          </FieldLabel>
        ))}
      </RadioGroup>

      {error && <FieldError>{error}</FieldError>}

      {verdict === null ? (
        <Button
          type="submit"
          className="w-full"
          disabled={selected === null || submitting}
        >
          {submitting ? "Checking..." : "Submit"}
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <Badge variant={verdict ? "default" : "destructive"}>
            {verdict ? "Correct" : "Incorrect"}
          </Badge>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={tryAgain}
          >
            Try again
          </Button>
        </div>
      )}

      <Link
        href="/mcq"
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        Back to questions
      </Link>
    </form>
  );
}
