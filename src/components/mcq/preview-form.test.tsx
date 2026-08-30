import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/mcq-client", () => ({
  submitAttemptRequest: vi.fn(),
}));

import { PreviewForm } from "@/components/mcq/preview-form";
import { submitAttemptRequest } from "@/lib/mcq-client";

const choices = [
  { id: "choice-1", text: "Paris", position: 0 },
  { id: "choice-2", text: "Lyon", position: 1 },
  { id: "choice-3", text: "Nice", position: 2 },
];

function renderPreview() {
  return render(
    <PreviewForm
      questionId="question-1"
      questionText="What is the capital of France?"
      choices={choices}
    />,
  );
}

function radios() {
  return screen.getAllByRole("radio");
}

function submitButton() {
  return screen.getByRole("button", { name: /submit/i }) as HTMLButtonElement;
}

function verdict(isCorrect: boolean) {
  return {
    ok: true,
    data: { attempt: { isCorrect, selectedChoiceId: "choice-1" } },
  } as never;
}

async function answerWith(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
) {
  await user.click(radios()[index]);
  await user.click(submitButton());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(submitAttemptRequest).mockResolvedValue(verdict(true));
});

describe("PreviewForm before answering", () => {
  it("shows the question text", () => {
    renderPreview();

    expect(screen.getByText("What is the capital of France?")).toBeTruthy();
  });

  it("offers every choice as a radio, in stored order", () => {
    renderPreview();

    expect(
      radios().map((radio) => radio.getAttribute("aria-label")),
    ).toEqual(["Paris", "Lyon", "Nice"]);
  });

  it("will not submit before a choice is picked", () => {
    renderPreview();

    expect(submitButton().disabled).toBe(true);
  });

  it("enables submit once a choice is picked", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(radios()[1]);

    expect(submitButton().disabled).toBe(false);
  });

  it("gives away nothing about the answer", () => {
    renderPreview();

    expect(document.body.textContent).not.toMatch(/correct/i);
  });

  it("offers a way back to the question list", () => {
    renderPreview();

    expect(
      screen
        .getByRole("link", { name: /back to questions/i })
        .getAttribute("href"),
    ).toBe("/mcq");
  });
});

describe("PreviewForm answering", () => {
  it("sends only the question and the selected choice id", async () => {
    const user = userEvent.setup();
    renderPreview();

    await answerWith(user, 1);

    expect(submitAttemptRequest).toHaveBeenCalledWith("question-1", "choice-2");
    expect(vi.mocked(submitAttemptRequest).mock.calls[0]).toHaveLength(2);
  });

  it("reports a correct answer using the server's verdict", async () => {
    const user = userEvent.setup();
    renderPreview();

    await answerWith(user, 0);

    expect(await screen.findByText("Correct")).toBeTruthy();
  });

  it("reports an incorrect answer using the server's verdict", async () => {
    vi.mocked(submitAttemptRequest).mockResolvedValue(verdict(false));

    const user = userEvent.setup();
    renderPreview();

    await answerWith(user, 1);

    expect(await screen.findByText("Incorrect")).toBeTruthy();
  });

  it("believes the server, having no answer key of its own", async () => {
    // The component was never told which choice is right, so a verdict it might consider
    // surprising is the only verdict it can show.
    vi.mocked(submitAttemptRequest).mockResolvedValue(verdict(false));

    const user = userEvent.setup();
    renderPreview();

    await answerWith(user, 0);

    expect(await screen.findByText("Incorrect")).toBeTruthy();
    expect(screen.queryByText("Correct")).toBeNull();
  });

  it("surfaces a failure rather than inventing a verdict", async () => {
    vi.mocked(submitAttemptRequest).mockResolvedValue({
      ok: false,
      formError: "Could not record attempt",
    } as never);

    const user = userEvent.setup();
    renderPreview();

    await answerWith(user, 0);

    expect(await screen.findByText("Could not record attempt")).toBeTruthy();
    expect(screen.queryByText("Correct")).toBeNull();
    expect(screen.queryByText("Incorrect")).toBeNull();
  });

  it("stops the teacher from resubmitting the same answer", async () => {
    const user = userEvent.setup();
    renderPreview();

    await answerWith(user, 0);
    await screen.findByText("Correct");

    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
  });

  it("lets the teacher try again from a clean slate", async () => {
    const user = userEvent.setup();
    renderPreview();

    await answerWith(user, 0);
    await screen.findByText("Correct");

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.queryByText("Correct")).toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(radios().every((r) => r.getAttribute("aria-checked") === "false")).toBe(
      true,
    );
  });
});
