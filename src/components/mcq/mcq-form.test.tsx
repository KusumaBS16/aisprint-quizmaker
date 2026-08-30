import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock("@/lib/mcq-client", () => ({
  createQuestionRequest: vi.fn(),
  updateQuestionRequest: vi.fn(),
}));

import { McqForm } from "@/components/mcq/mcq-form";
import { createQuestionRequest, updateQuestionRequest } from "@/lib/mcq-client";

// Base UI renders a radio as a span with role="radio" and aria-checked, not a native input,
// so checkedness is read from the attribute rather than the DOM property.
function isChecked(element: HTMLElement) {
  return element.getAttribute("aria-checked") === "true";
}

function isDisabled(element: HTMLElement) {
  return (element as HTMLButtonElement).disabled;
}

function choiceInputs() {
  return screen.getAllByRole("textbox", {
    name: /^choice \d+$/i,
  }) as HTMLInputElement[];
}

function choiceValues() {
  return choiceInputs().map((input) => input.value);
}

function correctRadios() {
  return screen.getAllByRole("radio", { name: /mark choice \d+ as correct/i });
}

function nameInput() {
  return screen.getByRole("textbox", { name: /^name$/i }) as HTMLInputElement;
}

function questionInput() {
  return screen.getByRole("textbox", {
    name: /^question$/i,
  }) as HTMLTextAreaElement;
}

function addChoiceButton() {
  return screen.getByRole("button", { name: /add choice/i });
}

function saveButton() {
  return screen.getByRole("button", { name: /^save$/i });
}

async function fillValidQuestion(user: ReturnType<typeof userEvent.setup>) {
  await user.type(nameInput(), "Capitals");
  await user.type(questionInput(), "Capital of France?");
  await user.type(choiceInputs()[0], "Paris");
  await user.type(choiceInputs()[1], "Lyon");
  await user.click(correctRadios()[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createQuestionRequest).mockResolvedValue({
    ok: true,
    data: { question: { id: "new-question-id" } },
  } as never);
  vi.mocked(updateQuestionRequest).mockResolvedValue({
    ok: true,
    data: { question: { id: "existing-id" } },
  } as never);
});

describe("McqForm shape", () => {
  it("starts with two empty choice rows", () => {
    render(<McqForm />);

    expect(choiceValues()).toEqual(["", ""]);
  });

  it("renders a name field and a question textarea", () => {
    render(<McqForm />);

    expect(nameInput().tagName).toBe("INPUT");
    expect(questionInput().tagName).toBe("TEXTAREA");
  });

  it("shows Save and Cancel side by side at equal width", () => {
    render(<McqForm />);

    const save = saveButton();
    const cancel = screen.getByRole("button", { name: /^cancel$/i });

    expect(save.parentElement).toBe(cancel.parentElement);
    expect(save.parentElement?.className).toContain("grid-cols-2");
    expect(save.className).toContain("w-full");
    expect(cancel.className).toContain("w-full");
  });
});

describe("McqForm choice rows", () => {
  it("adds a choice row when asked", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.click(addChoiceButton());

    expect(choiceInputs()).toHaveLength(3);
  });

  it("stops adding choices at six", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    for (let i = 0; i < 4; i += 1) {
      await user.click(addChoiceButton());
    }

    expect(choiceInputs()).toHaveLength(6);
    expect(isDisabled(addChoiceButton())).toBe(true);
  });

  it("does not allow removing a choice while only two remain", () => {
    render(<McqForm />);

    const removes = screen.getAllByRole("button", { name: /remove choice/i });
    expect(removes).toHaveLength(2);
    expect(removes.every(isDisabled)).toBe(true);
  });

  it("allows removing once there are three choices", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.click(addChoiceButton());
    await user.click(screen.getByRole("button", { name: /remove choice 3/i }));

    expect(choiceInputs()).toHaveLength(2);
  });

  it("removes the row the teacher pointed at, not the last one", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.click(addChoiceButton());
    await user.type(choiceInputs()[0], "Paris");
    await user.type(choiceInputs()[1], "Lyon");
    await user.type(choiceInputs()[2], "Nice");

    await user.click(screen.getByRole("button", { name: /remove choice 2/i }));

    expect(choiceValues()).toEqual(["Paris", "Nice"]);
  });

  it("renumbers the remaining rows after a removal", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.click(addChoiceButton());
    await user.click(screen.getByRole("button", { name: /remove choice 1/i }));

    expect(
      screen.getAllByRole("button", { name: /remove choice/i }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /remove choice 3/i }),
    ).toBeNull();
  });

  it("keeps the correct mark on the right row after a removal", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.click(addChoiceButton());
    await user.type(choiceInputs()[0], "Paris");
    await user.type(choiceInputs()[1], "Lyon");
    await user.type(choiceInputs()[2], "Nice");
    await user.click(correctRadios()[2]);

    await user.click(screen.getByRole("button", { name: /remove choice 1/i }));

    expect(choiceValues()).toEqual(["Lyon", "Nice"]);
    expect(correctRadios().map(isChecked)).toEqual([false, true]);
  });

  it("marks exactly one choice correct, unmarking the previous one", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.click(correctRadios()[0]);
    expect(correctRadios().map(isChecked)).toEqual([true, false]);

    await user.click(correctRadios()[1]);
    expect(correctRadios().map(isChecked)).toEqual([false, true]);
  });
});

describe("McqForm validation", () => {
  it("refuses to submit without a name and says so", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.type(questionInput(), "Capital of France?");
    await user.type(choiceInputs()[0], "Paris");
    await user.type(choiceInputs()[1], "Lyon");
    await user.click(correctRadios()[0]);
    await user.click(saveButton());

    expect(createQuestionRequest).not.toHaveBeenCalled();
    expect(screen.getByText("Question name is required")).toBeTruthy();
  });

  it("refuses to submit without question text", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.type(nameInput(), "Capitals");
    await user.type(choiceInputs()[0], "Paris");
    await user.type(choiceInputs()[1], "Lyon");
    await user.click(correctRadios()[0]);
    await user.click(saveButton());

    expect(createQuestionRequest).not.toHaveBeenCalled();
    expect(screen.getByText("Question text is required")).toBeTruthy();
  });

  it("refuses to submit when no choice is marked correct", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.type(nameInput(), "Capitals");
    await user.type(questionInput(), "Capital of France?");
    await user.type(choiceInputs()[0], "Paris");
    await user.type(choiceInputs()[1], "Lyon");
    await user.click(saveButton());

    expect(createQuestionRequest).not.toHaveBeenCalled();
    expect(
      screen.getByText("Exactly one choice must be marked as correct"),
    ).toBeTruthy();
  });

  it("refuses to submit when a choice is empty", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.type(nameInput(), "Capitals");
    await user.type(questionInput(), "Capital of France?");
    await user.type(choiceInputs()[0], "Paris");
    await user.click(correctRadios()[0]);
    await user.click(saveButton());

    expect(createQuestionRequest).not.toHaveBeenCalled();
    expect(screen.getByText("Every choice needs text")).toBeTruthy();
  });

  it("uses the same wording the API would have used", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.click(saveButton());

    // These strings live in the shared Zod schema, so the client-side check and a 400 from
    // the server cannot disagree about what to call the same problem.
    expect(screen.getByText("Question name is required")).toBeTruthy();
    expect(screen.getByText("Question text is required")).toBeTruthy();
  });
});

describe("McqForm creating", () => {
  it("posts the question and returns to the list", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await fillValidQuestion(user);
    await user.click(saveButton());

    expect(createQuestionRequest).toHaveBeenCalledWith({
      name: "Capitals",
      questionText: "Capital of France?",
      choices: [
        { text: "Paris", isCorrect: true },
        { text: "Lyon", isCorrect: false },
      ],
    });
    expect(push).toHaveBeenCalledWith("/mcq");
  });

  it("surfaces a field error the server sends back", async () => {
    vi.mocked(createQuestionRequest).mockResolvedValue({
      ok: false,
      fields: { name: "Question name is required" },
    } as never);

    const user = userEvent.setup();
    render(<McqForm />);

    await fillValidQuestion(user);
    await user.click(saveButton());

    expect(await screen.findByText("Question name is required")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the teacher's work on screen when the save fails", async () => {
    vi.mocked(createQuestionRequest).mockResolvedValue({
      ok: false,
      formError: "Could not create question",
    } as never);

    const user = userEvent.setup();
    render(<McqForm />);

    await fillValidQuestion(user);
    await user.click(saveButton());

    expect(await screen.findByText("Could not create question")).toBeTruthy();
    expect(choiceValues()).toEqual(["Paris", "Lyon"]);
    expect(isDisabled(saveButton())).toBe(false);
  });

  it("goes back to the list on cancel without saving", async () => {
    const user = userEvent.setup();
    render(<McqForm />);

    await user.type(nameInput(), "Half-finished");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(createQuestionRequest).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/mcq");
  });
});

describe("McqForm editing", () => {
  const initial = {
    name: "Capitals of Europe",
    questionText: "What is the capital of France?",
    choices: [
      { text: "Paris", isCorrect: true },
      { text: "Lyon", isCorrect: false },
      { text: "Nice", isCorrect: false },
    ],
  };

  function renderEdit() {
    return render(<McqForm questionId="existing-id" initial={initial} />);
  }

  it("prefills the stored question", () => {
    renderEdit();

    expect(nameInput().value).toBe("Capitals of Europe");
    expect(questionInput().value).toBe("What is the capital of France?");
    expect(choiceValues()).toEqual(["Paris", "Lyon", "Nice"]);
  });

  it("shows which choice is already marked correct", () => {
    renderEdit();

    expect(correctRadios().map(isChecked)).toEqual([true, false, false]);
  });

  it("updates rather than creating, carrying a new fourth choice", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(addChoiceButton());
    await user.type(choiceInputs()[3], "Toulouse");
    await user.click(saveButton());

    expect(createQuestionRequest).not.toHaveBeenCalled();
    expect(updateQuestionRequest).toHaveBeenCalledWith("existing-id", {
      name: "Capitals of Europe",
      questionText: "What is the capital of France?",
      choices: [
        { text: "Paris", isCorrect: true },
        { text: "Lyon", isCorrect: false },
        { text: "Nice", isCorrect: false },
        { text: "Toulouse", isCorrect: false },
      ],
    });
    expect(push).toHaveBeenCalledWith("/mcq");
  });

  it("can move the correct answer to a different choice", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(correctRadios()[2]);
    await user.click(saveButton());

    expect(updateQuestionRequest).toHaveBeenCalledWith(
      "existing-id",
      expect.objectContaining({
        choices: [
          { text: "Paris", isCorrect: false },
          { text: "Lyon", isCorrect: false },
          { text: "Nice", isCorrect: true },
        ],
      }),
    );
  });
});
