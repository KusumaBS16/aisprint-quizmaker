import { describe, expect, it } from "vitest";

import { toFieldErrors } from "@/lib/validation/auth";
import { attemptSchema, questionSchema } from "@/lib/validation/mcq";

function validQuestion() {
  return {
    name: "Capitals of Europe",
    questionText: "What is the capital of France?",
    choices: [
      { text: "Paris", isCorrect: true },
      { text: "Lyon", isCorrect: false },
    ],
  };
}

function choices(count: number, correctIndex: number | null) {
  return Array.from({ length: count }, (_, index) => ({
    text: `Choice ${index + 1}`,
    isCorrect: index === correctIndex,
  }));
}

function fieldsFor(body: unknown): Record<string, string> {
  const parsed = questionSchema.safeParse(body);
  if (parsed.success) {
    throw new Error("Expected the body to be rejected, but it parsed");
  }
  return toFieldErrors(parsed.error);
}

describe("questionSchema", () => {
  it("accepts a well-formed question", () => {
    expect(questionSchema.safeParse(validQuestion()).success).toBe(true);
  });

  it("trims the name and question text", () => {
    const parsed = questionSchema.parse({
      ...validQuestion(),
      name: "  Capitals of Europe  ",
      questionText: "  What is the capital of France?  ",
    });

    expect(parsed.name).toBe("Capitals of Europe");
    expect(parsed.questionText).toBe("What is the capital of France?");
  });

  it("trims choice text", () => {
    const parsed = questionSchema.parse({
      ...validQuestion(),
      choices: [
        { text: "  Paris  ", isCorrect: true },
        { text: "Lyon", isCorrect: false },
      ],
    });

    expect(parsed.choices[0].text).toBe("Paris");
  });

  it("rejects a missing name", () => {
    const { name, ...withoutName } = validQuestion();
    void name;

    expect(fieldsFor(withoutName)).toHaveProperty("name");
  });

  it("rejects a name that is only whitespace", () => {
    expect(fieldsFor({ ...validQuestion(), name: "   " })).toHaveProperty(
      "name",
    );
  });

  it("rejects a missing question text", () => {
    const { questionText, ...withoutText } = validQuestion();
    void questionText;

    expect(fieldsFor(withoutText)).toHaveProperty("questionText");
  });

  it("rejects question text that is only whitespace", () => {
    expect(
      fieldsFor({ ...validQuestion(), questionText: "  " }),
    ).toHaveProperty("questionText");
  });

  it("rejects a single choice", () => {
    expect(
      fieldsFor({ ...validQuestion(), choices: choices(1, 0) }),
    ).toHaveProperty("choices");
  });

  it("rejects an empty choice list", () => {
    expect(fieldsFor({ ...validQuestion(), choices: [] })).toHaveProperty(
      "choices",
    );
  });

  it("accepts the minimum of two choices", () => {
    expect(
      questionSchema.safeParse({ ...validQuestion(), choices: choices(2, 0) })
        .success,
    ).toBe(true);
  });

  it("accepts the maximum of six choices", () => {
    expect(
      questionSchema.safeParse({ ...validQuestion(), choices: choices(6, 0) })
        .success,
    ).toBe(true);
  });

  it("rejects seven choices", () => {
    expect(
      fieldsFor({ ...validQuestion(), choices: choices(7, 0) }),
    ).toHaveProperty("choices");
  });

  it("rejects an empty choice text", () => {
    expect(
      fieldsFor({
        ...validQuestion(),
        choices: [
          { text: "Paris", isCorrect: true },
          { text: "", isCorrect: false },
        ],
      }),
    ).toHaveProperty("choices");
  });

  it("rejects a choice that is only whitespace", () => {
    expect(
      fieldsFor({
        ...validQuestion(),
        choices: [
          { text: "Paris", isCorrect: true },
          { text: "   ", isCorrect: false },
        ],
      }),
    ).toHaveProperty("choices");
  });

  it("rejects a question with no correct choice", () => {
    expect(
      fieldsFor({ ...validQuestion(), choices: choices(3, null) }),
    ).toHaveProperty("choices");
  });

  it("rejects a question with two correct choices", () => {
    expect(
      fieldsFor({
        ...validQuestion(),
        choices: [
          { text: "Paris", isCorrect: true },
          { text: "Lyon", isCorrect: true },
        ],
      }),
    ).toHaveProperty("choices");
  });

  it("rejects a question where every choice is correct", () => {
    expect(
      fieldsFor({
        ...validQuestion(),
        choices: [
          { text: "Paris", isCorrect: true },
          { text: "Lyon", isCorrect: true },
          { text: "Nice", isCorrect: true },
        ],
      }),
    ).toHaveProperty("choices");
  });

  it("requires isCorrect to be a boolean rather than a truthy string", () => {
    expect(
      fieldsFor({
        ...validQuestion(),
        choices: [
          { text: "Paris", isCorrect: "yes" },
          { text: "Lyon", isCorrect: false },
        ],
      }),
    ).toHaveProperty("choices");
  });

  it("rejects a non-object body", () => {
    expect(questionSchema.safeParse(null).success).toBe(false);
    expect(questionSchema.safeParse("question").success).toBe(false);
    expect(questionSchema.safeParse([]).success).toBe(false);
  });

  it("strips unknown keys rather than trusting them", () => {
    const parsed = questionSchema.parse({
      ...validQuestion(),
      createdBy: "some-user-id",
      id: "attacker-chosen-id",
    });

    expect(parsed).not.toHaveProperty("createdBy");
    expect(parsed).not.toHaveProperty("id");
  });

  it("reports one message per field, matching the auth routes", () => {
    const fields = fieldsFor({ name: "", questionText: "", choices: [] });

    expect(Object.keys(fields).sort()).toEqual([
      "choices",
      "name",
      "questionText",
    ]);
    for (const message of Object.values(fields)) {
      expect(typeof message).toBe("string");
    }
  });
});

describe("attemptSchema", () => {
  it("accepts a selected choice id", () => {
    expect(
      attemptSchema.safeParse({ selectedChoiceId: "choice-paris" }).success,
    ).toBe(true);
  });

  it("rejects a missing selection", () => {
    const parsed = attemptSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(toFieldErrors(parsed.error)).toHaveProperty("selectedChoiceId");
    }
  });

  it("rejects an empty selection", () => {
    expect(attemptSchema.safeParse({ selectedChoiceId: "" }).success).toBe(
      false,
    );
  });

  it("rejects a whitespace-only selection", () => {
    expect(attemptSchema.safeParse({ selectedChoiceId: "   " }).success).toBe(
      false,
    );
  });

  it("ignores any correctness the client tries to send", () => {
    const parsed = attemptSchema.parse({
      selectedChoiceId: "choice-lyon",
      isCorrect: true,
    });

    expect(parsed).toEqual({ selectedChoiceId: "choice-lyon" });
    expect(parsed).not.toHaveProperty("isCorrect");
  });
});
