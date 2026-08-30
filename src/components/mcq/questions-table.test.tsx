import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/mcq-client", () => ({
  deleteQuestionRequest: vi.fn(),
}));

import { QuestionsTable } from "@/components/mcq/questions-table";

const questions = [
  {
    id: "question-1",
    name: "Capitals of Europe",
    questionText: "What is the capital of France?",
    createdBy: null,
    createdAt: "2026-08-30 10:00:00",
    updatedAt: "2026-08-30 10:00:00",
  },
  {
    id: "question-2",
    name: "Primary colours",
    questionText: "Which of these is a primary colour?",
    createdBy: null,
    createdAt: "2026-08-30 11:00:00",
    updatedAt: "2026-08-30 11:00:00",
  },
];

function bodyRows() {
  return screen.getAllByRole("row").slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuestionsTable", () => {
  it("has a header row of name, question and actions", () => {
    render(<QuestionsTable questions={questions} />);

    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Name", "Question", "Actions"]);
  });

  it("renders one row per question with its name and text", () => {
    render(<QuestionsTable questions={questions} />);

    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Capitals of Europe")).toBeTruthy();
    expect(
      within(rows[0]).getByText("What is the capital of France?"),
    ).toBeTruthy();
    expect(within(rows[1]).getByText("Primary colours")).toBeTruthy();
    expect(
      within(rows[1]).getByText("Which of these is a primary colour?"),
    ).toBeTruthy();
  });

  it("keeps the order the server sent", () => {
    render(<QuestionsTable questions={questions} />);

    const names = bodyRows().map(
      (row) => within(row).getAllByRole("cell")[0].textContent,
    );
    expect(names).toEqual(["Capitals of Europe", "Primary colours"]);
  });

  it("gives every row its own actions control", () => {
    render(<QuestionsTable questions={questions} />);

    expect(
      screen.getByRole("button", { name: /actions for capitals of europe/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /actions for primary colours/i }),
    ).toBeTruthy();
  });

  it("says so plainly when there are no questions yet", () => {
    render(<QuestionsTable questions={[]} />);

    expect(screen.getByText(/no questions yet/i)).toBeTruthy();
    expect(bodyRows()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /actions for/i })).toBeNull();
  });

  it("offers a create button that links to the new question page", () => {
    render(<QuestionsTable questions={questions} />);

    expect(
      screen
        .getByRole("link", { name: /create question/i })
        .getAttribute("href"),
    ).toBe("/mcq/new");
  });

  it("still offers create when the table is empty", () => {
    render(<QuestionsTable questions={[]} />);

    expect(screen.getByRole("link", { name: /create question/i })).toBeTruthy();
  });

  it("keeps the create button out of the table itself", () => {
    render(<QuestionsTable questions={questions} />);

    expect(
      screen.getByRole("link", { name: /create question/i }).closest("table"),
    ).toBeNull();
  });

  it("never says anything about which answer is correct", () => {
    render(<QuestionsTable questions={questions} />);

    expect(document.body.textContent).not.toMatch(/correct/i);
  });
});
