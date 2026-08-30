// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/mcq-service", () => ({
  recordAttempt: vi.fn(),
}));

import { recordAttempt } from "@/lib/services/mcq-service";

import { POST } from "./route";

const QUESTION_ID = "0f8fad5bd9cb469fa16570867728950e";

function context(id = QUESTION_ID) {
  return { params: Promise.resolve({ id }) };
}

// response.json() is typed unknown, so narrow once here rather than asserting inline at
// every call site.
type ErrorBody = { error?: string; fields?: Record<string, string> };

async function errorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

function postRequest(body: unknown) {
  return new Request(`http://localhost/api/mcq/${QUESTION_ID}/attempts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(recordAttempt).mockResolvedValue({
    isCorrect: true,
    selectedChoiceId: "choice-paris",
  });
});

describe("POST /api/mcq/[id]/attempts", () => {
  it("returns 201 with the server's verdict", async () => {
    const response = await POST(
      postRequest({ selectedChoiceId: "choice-paris" }),
      context(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      attempt: { isCorrect: true, selectedChoiceId: "choice-paris" },
    });
  });

  it("reports an incorrect answer as incorrect", async () => {
    vi.mocked(recordAttempt).mockResolvedValue({
      isCorrect: false,
      selectedChoiceId: "choice-lyon",
    });

    const response = await POST(
      postRequest({ selectedChoiceId: "choice-lyon" }),
      context(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      attempt: { isCorrect: false, selectedChoiceId: "choice-lyon" },
    });
  });

  it("passes the question id from the path and the selected choice from the body", async () => {
    await POST(
      postRequest({ selectedChoiceId: "choice-paris" }),
      context("another-question"),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      "another-question",
      "choice-paris",
    );
  });

  // The point of the whole design: a client that claims it was right is still told it was
  // wrong, because the verdict comes from the service reading stored data.
  it("ignores a forged correctness claim in the body", async () => {
    vi.mocked(recordAttempt).mockResolvedValue({
      isCorrect: false,
      selectedChoiceId: "choice-lyon",
    });

    const response = await POST(
      postRequest({ selectedChoiceId: "choice-lyon", isCorrect: true }),
      context(),
    );

    await expect(response.json()).resolves.toEqual({
      attempt: { isCorrect: false, selectedChoiceId: "choice-lyon" },
    });
  });

  it("never forwards a correctness claim to the service", async () => {
    await POST(
      postRequest({ selectedChoiceId: "choice-lyon", isCorrect: true }),
      context(),
    );

    expect(recordAttempt).toHaveBeenCalledWith(QUESTION_ID, "choice-lyon");
    expect(recordAttempt).not.toHaveBeenCalledWith(
      QUESTION_ID,
      "choice-lyon",
      expect.anything(),
    );
  });

  it("returns 404 when the choice does not belong to the question", async () => {
    vi.mocked(recordAttempt).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ selectedChoiceId: "choice-from-another-question" }),
      context(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Question not found",
    });
  });

  it("gives the same 404 for an unknown question and an unknown choice, so ids cannot be probed", async () => {
    vi.mocked(recordAttempt).mockResolvedValue(undefined);

    const unknownQuestion = await POST(
      postRequest({ selectedChoiceId: "choice-paris" }),
      context("no-such-question"),
    );
    const unknownChoice = await POST(
      postRequest({ selectedChoiceId: "no-such-choice" }),
      context(),
    );

    expect(unknownQuestion.status).toBe(unknownChoice.status);
    await expect(unknownQuestion.json()).resolves.toEqual(
      await unknownChoice.json(),
    );
  });

  it("returns 400 when no choice was selected", async () => {
    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body).toHaveProperty("error", "Validation failed");
    expect(body.fields).toHaveProperty("selectedChoiceId");
    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty selection", async () => {
    const response = await POST(
      postRequest({ selectedChoiceId: "" }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it("returns 400 rather than 500 for malformed JSON", async () => {
    const response = await POST(postRequest("{ not json"), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
    });
    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic message when the service throws", async () => {
    vi.mocked(recordAttempt).mockRejectedValue(new Error("D1 is down"));

    const response = await POST(
      postRequest({ selectedChoiceId: "choice-paris" }),
      context(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not record attempt",
    });
  });
});
