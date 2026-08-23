import type { Metadata } from "next";

import { LogoutButton } from "@/components/auth/logout-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Quiz - QuizMaker",
};

// Hard-coded on purpose. There is no quiz storage in Sprint 1, and inventing one here would
// be work the next sprint has to undo.
const QUESTIONS = [
  {
    prompt: "Which Cloudflare product stores this app's user rows?",
    options: ["D1", "R2", "KV", "Durable Objects"],
  },
  {
    prompt: "Which key derivation function hashes passwords in this sprint?",
    options: ["PBKDF2-SHA256", "bcrypt", "MD5", "Plain SHA-1"],
  },
  {
    prompt: "What keeps a user signed in after they log in here?",
    options: [
      "Nothing - there is no session yet",
      "A cookie",
      "A JWT",
      "A session table in D1",
    ],
  },
];

export default function McqPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="font-semibold">QuizMaker</span>
          <Badge variant="secondary">Placeholder</Badge>
        </div>
        <LogoutButton />
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            This page is a placeholder.
          </p>
          <p className="mt-1">
            The questions below are hard-coded, nothing is scored, and no answer
            is saved. This page is also reachable without logging in, because
            Sprint 1 has no session management - that is expected here, not a
            bug.
          </p>
        </div>

        {QUESTIONS.map((question, questionIndex) => (
          <Card key={question.prompt}>
            <CardHeader>
              <CardTitle className="text-base">
                {questionIndex + 1}. {question.prompt}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <fieldset className="flex flex-col gap-3">
                <legend className="sr-only">{question.prompt}</legend>
                {question.options.map((option, optionIndex) => {
                  const id = `q${questionIndex}-o${optionIndex}`;
                  return (
                    <div key={option} className="flex items-center gap-3">
                      <input
                        type="radio"
                        id={id}
                        name={`question-${questionIndex}`}
                        value={option}
                        className="size-4 accent-primary"
                      />
                      <label htmlFor={id} className="text-sm">
                        {option}
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
