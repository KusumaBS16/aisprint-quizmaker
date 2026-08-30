// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/mcq-service", () => ({
  findQuestionById: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
}));

import {
  deleteQuestion,
  findQuestionById,
  updateQuestion,
  type PublicQuestionWithChoices,
} from "@/lib/services/mcq-service";

import { DELETE, GET, PUT } from "./route";

const QUESTION_ID = "0f8fad5bd9cb469fa16570867728950e";

const questionWithChoices: PublicQuestionWithChoices = {
  id: QUESTION_ID,
  name: "Capitals of Europe",
  questionText: "What is the capital of France?",
  createdBy: null,
  createdAt: "2026-08-30 12:00:00",
  updatedAt: "2026-08-30 12:00:00",
  choices: [
    { id: "choice-paris", text: "Paris", position: 0 },
    { id: "choice-lyon", text: "Lyon", position: 1 },
  ],
};

function validBody() {
  return {
    name: "Capitals of Europe",
    questionText: "What is the capital of France?",
    choices: [
      { text: "Paris", isCorrect: true },
      { text: "Lyon", isCorrect: false },
    ],
  };
}

function context(id = QUESTION_ID) {
  return { params: Promise.resolve({ id }) };
}

// response.json() is typed unknown, so narrow once here rather than asserting inline at
// every call site.
type ErrorBody = { error?: string; fields?: Record<string, string> };

async function errorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

function request(method: string, body?: unknown) {
  return new Request(`http://localhost/api/mcq/${QUESTION_ID}`, {
    method,
    headers: { "content-type": "application/json" },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(findQuestionById).mockResolvedValue(questionWithChoices);
  vi.mocked(updateQuestion).mockResolvedValue(questionWithChoices);
  vi.mocked(deleteQuestion).mockResolvedValue(true);
});

describe("GET /api/mcq/[id]", () => {
  it("returns 200 with the question and its choices", async () => {
    const response = await GET(request("GET"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      question: questionWithChoices,
    });
  });

  it("looks the question up by the id in the path", async () => {
    await GET(request("GET"), context("another-id"));

    expect(findQuestionById).toHaveBeenCalledWith("another-id");
  });

  it("returns 404 for an unknown question", async () => {
    vi.mocked(findQuestionById).mockResolvedValue(undefined);

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Question not found",
    });
  });

  it("never sends the correct-answer flag to the client", async () => {
    const response = await GET(request("GET"), context());
    const body = JSON.stringify(await response.json());

    expect(body).not.toContain("isCorrect");
    expect(body).not.toContain("is_correct");
  });

  it("returns 500 with a generic message when the service throws", async () => {
    vi.mocked(findQuestionById).mockRejectedValue(new Error("D1 is down"));

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not load question",
    });
  });
});

describe("PUT /api/mcq/[id]", () => {
  it("returns 200 with the updated question", async () => {
    const response = await PUT(request("PUT", validBody()), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      question: questionWithChoices,
    });
  });

  it("passes the id and the validated body to the service", async () => {
    await PUT(request("PUT", validBody()), context());

    expect(updateQuestion).toHaveBeenCalledWith(QUESTION_ID, {
      name: "Capitals of Europe",
      questionText: "What is the capital of France?",
      choices: [
        { text: "Paris", isCorrect: true },
        { text: "Lyon", isCorrect: false },
      ],
    });
  });

  it("returns 404 for an unknown question", async () => {
    vi.mocked(updateQuestion).mockResolvedValue(undefined);

    const response = await PUT(request("PUT", validBody()), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Question not found",
    });
  });

  it("applies the same validation as create", async () => {
    const response = await PUT(
      request("PUT", { ...validBody(), name: "" }),
      context(),
    );

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body).toHaveProperty("error", "Validation failed");
    expect(body.fields).toHaveProperty("name");
    expect(updateQuestion).not.toHaveBeenCalled();
  });

  it("returns 400 when the choice rules are broken", async () => {
    const response = await PUT(
      request("PUT", {
        ...validBody(),
        choices: [
          { text: "Paris", isCorrect: true },
          { text: "Lyon", isCorrect: true },
        ],
      }),
      context(),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).fields).toHaveProperty("choices");
  });

  it("returns 400 rather than 500 for malformed JSON", async () => {
    const response = await PUT(request("PUT", "{ not json"), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
    });
    expect(updateQuestion).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic message when the service throws", async () => {
    vi.mocked(updateQuestion).mockRejectedValue(new Error("D1 is down"));

    const response = await PUT(request("PUT", validBody()), context());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not update question",
    });
  });
});

describe("DELETE /api/mcq/[id]", () => {
  it("returns 200 when the question was deleted", async () => {
    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("deletes the question named in the path", async () => {
    await DELETE(request("DELETE"), context("another-id"));

    expect(deleteQuestion).toHaveBeenCalledWith("another-id");
  });

  it("returns 404 when there was nothing to delete", async () => {
    vi.mocked(deleteQuestion).mockResolvedValue(false);

    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Question not found",
    });
  });

  it("needs no request body", async () => {
    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(200);
  });

  it("returns 500 with a generic message when the service throws", async () => {
    vi.mocked(deleteQuestion).mockRejectedValue(new Error("D1 is down"));

    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not delete question",
    });
  });
});
