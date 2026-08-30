"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { createQuestionRequest, updateQuestionRequest } from "@/lib/mcq-client";
import type { AuthoringChoice } from "@/lib/services/mcq-service";
import { toFieldErrors } from "@/lib/validation/auth";
import { questionSchema } from "@/lib/validation/mcq";

const MIN_CHOICES = 2;
const MAX_CHOICES = 6;

// Rows carry a key of their own rather than leaning on their index, so that removing a row
// moves neither React's identity for the surviving rows nor the correct mark, which is stored
// as one of these keys.
interface ChoiceRowState {
  key: number;
  text: string;
}

export interface McqFormInitialValues {
  name: string;
  questionText: string;
  choices: AuthoringChoice[];
}

export interface McqFormProps {
  questionId?: string;
  initial?: McqFormInitialValues;
}

function startingRows(initial?: McqFormInitialValues) {
  const texts = initial?.choices.map((choice) => choice.text) ?? [
    "",
    "",
  ];
  return texts.map((text, index) => ({ key: index, text }));
}

function startingCorrectKey(initial?: McqFormInitialValues) {
  const index = initial?.choices.findIndex((choice) => choice.isCorrect) ?? -1;
  return index >= 0 ? index : null;
}

export function McqForm({ questionId, initial }: McqFormProps) {
  const router = useRouter();
  const isEditing = questionId !== undefined;

  const [name, setName] = useState(initial?.name ?? "");
  const [questionText, setQuestionText] = useState(initial?.questionText ?? "");
  const [rows, setRows] = useState<ChoiceRowState[]>(() =>
    startingRows(initial),
  );
  const [correctKey, setCorrectKey] = useState<number | null>(() =>
    startingCorrectKey(initial),
  );
  const [nextKey, setNextKey] = useState(() => startingRows(initial).length);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function addChoice() {
    if (rows.length >= MAX_CHOICES) {
      return;
    }
    setRows((current) => [...current, { key: nextKey, text: "" }]);
    setNextKey((current) => current + 1);
  }

  function removeChoice(key: number) {
    if (rows.length <= MIN_CHOICES) {
      return;
    }
    setRows((current) => current.filter((row) => row.key !== key));
    if (correctKey === key) {
      setCorrectKey(null);
    }
  }

  function editChoice(key: number, text: string) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, text } : row)),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const input = {
      name,
      questionText,
      choices: rows.map((row) => ({
        text: row.text,
        isCorrect: row.key === correctKey,
      })),
    };

    // The same schema the route validates against, so the message shown before the request
    // and the message a 400 would carry are the same string.
    const parsed = questionSchema.safeParse(input);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    const result = isEditing
      ? await updateQuestionRequest(questionId, parsed.data)
      : await createQuestionRequest(parsed.data);

    if (result.ok) {
      router.push("/mcq");
      router.refresh();
      return;
    }

    if (result.fields) {
      setFieldErrors(result.fields);
    } else {
      setFormError(result.formError);
    }

    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup>
        {formError && <FieldError>{formError}</FieldError>}

        <Field data-invalid={Boolean(fieldErrors.name)}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            name="name"
            value={name}
            aria-invalid={Boolean(fieldErrors.name)}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError
            errors={
              fieldErrors.name ? [{ message: fieldErrors.name }] : undefined
            }
          />
        </Field>

        <Field data-invalid={Boolean(fieldErrors.questionText)}>
          <FieldLabel htmlFor="questionText">Question</FieldLabel>
          <Textarea
            id="questionText"
            name="questionText"
            rows={4}
            value={questionText}
            aria-invalid={Boolean(fieldErrors.questionText)}
            onChange={(event) => setQuestionText(event.target.value)}
          />
          <FieldError
            errors={
              fieldErrors.questionText
                ? [{ message: fieldErrors.questionText }]
                : undefined
            }
          />
        </Field>

        <FieldSet>
          <FieldLegend>Choices</FieldLegend>
          <FieldDescription>
            Between {MIN_CHOICES} and {MAX_CHOICES} choices. Mark exactly one as
            correct.
          </FieldDescription>

          <RadioGroup
            value={correctKey === null ? null : String(correctKey)}
            onValueChange={(value) => setCorrectKey(Number(value))}
          >
            {rows.map((row, index) => (
              <div key={row.key} className="flex items-center gap-3">
                <Input
                  aria-label={`Choice ${index + 1}`}
                  placeholder={`Choice ${index + 1}`}
                  value={row.text}
                  aria-invalid={Boolean(fieldErrors.choices)}
                  onChange={(event) => editChoice(row.key, event.target.value)}
                  className="flex-1"
                />
                <FieldLabel className="w-auto shrink-0 flex-row items-center gap-2 font-normal">
                  <RadioGroupItem
                    value={String(row.key)}
                    aria-label={`Mark choice ${index + 1} as correct`}
                  />
                  <span className="text-sm">Correct</span>
                </FieldLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove choice ${index + 1}`}
                  disabled={rows.length <= MIN_CHOICES}
                  onClick={() => removeChoice(row.key)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </RadioGroup>

          <FieldError
            errors={
              fieldErrors.choices
                ? [{ message: fieldErrors.choices }]
                : undefined
            }
          />

          <Button
            type="button"
            variant="outline"
            onClick={addChoice}
            disabled={rows.length >= MAX_CHOICES}
          >
            <Plus />
            Add choice
          </Button>
        </FieldSet>

        <div className="grid grid-cols-2 gap-3">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Saving..." : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={submitting}
            onClick={() => router.push("/mcq")}
          >
            Cancel
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
