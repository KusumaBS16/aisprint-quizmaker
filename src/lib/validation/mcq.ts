import { z } from "zod";

// One message per field, used for every way that field can fail, matching the approach in
// auth.ts. The API returns a single string per field, so a field that breaks two rules still
// has exactly one thing to say, and the form renders these strings verbatim.
const NAME_MESSAGE = "Question name is required";
const QUESTION_TEXT_MESSAGE = "Question text is required";
const CHOICE_TEXT_MESSAGE = "Every choice needs text";
const CHOICE_COUNT_MESSAGE = "There must be between 2 and 6 choices";
const EXACTLY_ONE_CORRECT_MESSAGE =
  "Exactly one choice must be marked as correct";
const SELECTION_MESSAGE = "Select an answer";

const choiceSchema = z.object({
  text: z
    .string({ error: CHOICE_TEXT_MESSAGE })
    .trim()
    .min(1, CHOICE_TEXT_MESSAGE)
    .max(500, CHOICE_TEXT_MESSAGE),
  isCorrect: z.boolean({ error: EXACTLY_ONE_CORRECT_MESSAGE }),
});

export const questionSchema = z.object({
  name: z
    .string({ error: NAME_MESSAGE })
    .trim()
    .min(1, NAME_MESSAGE)
    .max(100, NAME_MESSAGE),
  questionText: z
    .string({ error: QUESTION_TEXT_MESSAGE })
    .trim()
    .min(1, QUESTION_TEXT_MESSAGE)
    .max(1000, QUESTION_TEXT_MESSAGE),
  // Two is the minimum that makes a question a choice at all; six is the cap the form
  // enforces by disabling "add choice". Exactly one correct answer is what preview checks
  // against, so a question with none or several is not a question this app can score.
  choices: z
    .array(choiceSchema)
    .min(2, CHOICE_COUNT_MESSAGE)
    .max(6, CHOICE_COUNT_MESSAGE)
    .refine(
      (choices) => choices.filter((choice) => choice.isCorrect).length === 1,
      { message: EXACTLY_ONE_CORRECT_MESSAGE },
    ),
});

// The client says which choice was picked and nothing else. Any correctness the caller tries
// to send is dropped here, and the verdict is read from storage in the service.
export const attemptSchema = z.object({
  selectedChoiceId: z
    .string({ error: SELECTION_MESSAGE })
    .trim()
    .min(1, SELECTION_MESSAGE),
});

export type QuestionInputBody = z.infer<typeof questionSchema>;
export type AttemptInputBody = z.infer<typeof attemptSchema>;
