import type {
  AttemptResult,
  PublicQuestionWithChoices,
  QuestionInput,
} from "@/lib/services/mcq-service";

// The MCQ counterpart to auth-client's postAuth, following the same rule: a 400 carrying
// `fields` belongs on the inputs, anything else with an `error` is a form-level message, and
// the API's own wording is shown verbatim rather than reworded here. It differs only in
// needing the response body back, since the caller uses what was written.
export type McqResult<T> =
  | { ok: true; data: T }
  | { ok: false; fields: Record<string, string>; formError?: undefined }
  | { ok: false; formError: string; fields?: undefined };

const UNREACHABLE = "Could not reach the server. Please try again.";
const UNEXPECTED = "Something went wrong. Please try again.";

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function read(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && key in body
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

async function send<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  payload?: unknown,
): Promise<McqResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    return { ok: false, formError: UNREACHABLE };
  }

  const body: unknown = await response.json().catch(() => null);

  if (response.ok) {
    return { ok: true, data: body as T };
  }

  const fields = read(body, "fields");
  if (isStringRecord(fields) && Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  const error = read(body, "error");
  return {
    ok: false,
    formError: typeof error === "string" ? error : UNEXPECTED,
  };
}

export function createQuestionRequest(input: QuestionInput) {
  return send<{ question: PublicQuestionWithChoices }>(
    "/api/mcq",
    "POST",
    input,
  );
}

export function updateQuestionRequest(id: string, input: QuestionInput) {
  return send<{ question: PublicQuestionWithChoices }>(
    `/api/mcq/${encodeURIComponent(id)}`,
    "PUT",
    input,
  );
}

export function deleteQuestionRequest(id: string) {
  return send<{ ok: true }>(`/api/mcq/${encodeURIComponent(id)}`, "DELETE");
}

// Deliberately takes no verdict argument. The only thing this request can say is which choice
// was selected; whether that was right is decided by the service reading stored rows.
export function submitAttemptRequest(
  questionId: string,
  selectedChoiceId: string,
) {
  return send<{ attempt: AttemptResult }>(
    `/api/mcq/${encodeURIComponent(questionId)}/attempts`,
    "POST",
    { selectedChoiceId },
  );
}
