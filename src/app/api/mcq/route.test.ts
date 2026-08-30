// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The service is the only thing these handlers may reach for. Mocking it at the module
// boundary keeps the route tests away from D1 entirely, as the Sprint 1 auth route tests do.
vi.mock("@/lib/services/mcq-service", () => ({
  listQuestions: vi.fn(),
  createQuestion: vi.fn(),
}));

import {
  createQuestion,
  listQuestions,
  type PublicQuestion,
  type PublicQuestionWithChoices,
} from "@/lib/services/mcq-service";

import { GET, POST } from "./route";

const question: PublicQuestion = {
  id: "0f8fad5bd9cb469fa16570867728950e",
  name: "Capitals of Europe",
  questionText: "What is the capital of France?",
  createdBy: null,
  createdAt: "2026-08-30 12:00:00",
  updatedAt: "2026-08-30 12:00:00",
};

const questionWithChoices: PublicQuestionWithChoices = {
  ...question,
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

// response.json() is typed unknown, so narrow once here rather than asserting inline at
// every call site.
type ErrorBody = { error?: string; fields?: Record<string, string> };

async function errorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/mcq", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(listQuestions).mockResolvedValue([question]);
  vi.mocked(createQuestion).mockResolvedValue(questionWithChoices);
});

describe("GET /api/mcq", () => {
  it("returns 200 with every question wrapped in a questions key", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ questions: [question] });
  });

  it("returns an empty list rather than a 404 when nothing exists yet", async () => {
    vi.mocked(listQuestions).mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ questions: [] });
  });

  it("returns 500 with a generic message when the service throws", async () => {
    vi.mocked(listQuestions).mockRejectedValue(new Error("D1 is down"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not load questions",
    });
  });

  it("does not leak the underlying error to the client", async () => {
    vi.mocked(listQuestions).mockRejectedValue(new Error("D1 is down"));

    const response = await GET();

    expect(JSON.stringify(await response.json())).not.toContain("D1 is down");
  });
});

describe("POST /api/mcq", () => {
  it("returns 201 with the created question and its choices", async () => {
    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      question: questionWithChoices,
    });
  });

  it("passes the validated body to the service", async () => {
    await POST(postRequest(validBody()));

    expect(createQuestion).toHaveBeenCalledWith({
      name: "Capitals of Europe",
      questionText: "What is the capital of France?",
      choices: [
        { text: "Paris", isCorrect: true },
        { text: "Lyon", isCorrect: false },
      ],
    });
  });

  it("passes the trimmed values, not the raw ones", async () => {
    await POST(
      postRequest({
        ...validBody(),
        name: "  Capitals of Europe  ",
      }),
    );

    expect(createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Capitals of Europe" }),
    );
  });

  it("never lets a caller choose the id or the author", async () => {
    await POST(
      postRequest({
        ...validBody(),
        id: "attacker-chosen-id",
        createdBy: "someone-else",
      }),
    );

    const [received] = vi.mocked(createQuestion).mock.calls[0];
    expect(received).not.toHaveProperty("id");
    expect(received).not.toHaveProperty("createdBy");
  });

  it("returns 400 in the auth routes' shape when validation fails", async () => {
    const response = await POST(postRequest({ ...validBody(), name: "" }));

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body).toHaveProperty("error", "Validation failed");
    expect(body.fields).toHaveProperty("name");
  });

  it("returns 400 for fewer than two choices", async () => {
    const response = await POST(
      postRequest({
        ...validBody(),
        choices: [{ text: "Paris", isCorrect: true }],
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).fields).toHaveProperty("choices");
  });

  it("returns 400 for more than six choices", async () => {
    const response = await POST(
      postRequest({
        ...validBody(),
        choices: Array.from({ length: 7 }, (_, index) => ({
          text: `Choice ${index}`,
          isCorrect: index === 0,
        })),
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).fields).toHaveProperty("choices");
  });

  it("returns 400 when no choice is marked correct", async () => {
    const response = await POST(
      postRequest({
        ...validBody(),
        choices: [
          { text: "Paris", isCorrect: false },
          { text: "Lyon", isCorrect: false },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).fields).toHaveProperty("choices");
  });

  it("returns 400 when two choices are marked correct", async () => {
    const response = await POST(
      postRequest({
        ...validBody(),
        choices: [
          { text: "Paris", isCorrect: true },
          { text: "Lyon", isCorrect: true },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).fields).toHaveProperty("choices");
  });

  it("returns 400 for an empty choice", async () => {
    const response = await POST(
      postRequest({
        ...validBody(),
        choices: [
          { text: "Paris", isCorrect: true },
          { text: "   ", isCorrect: false },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).fields).toHaveProperty("choices");
  });

  it("writes nothing when validation fails", async () => {
    await POST(postRequest({ ...validBody(), name: "" }));

    expect(createQuestion).not.toHaveBeenCalled();
  });

  it("returns 400 rather than 500 for malformed JSON", async () => {
    const response = await POST(postRequest("{ not json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
    });
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic message when the service throws", async () => {
    vi.mocked(createQuestion).mockRejectedValue(new Error("D1 is down"));

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not create question",
    });
  });
});
