import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: routerRefresh }),
}));

vi.mock("@/lib/mcq-client", () => ({
  deleteQuestionRequest: vi.fn(),
}));

import { QuestionActions } from "@/components/mcq/question-actions";
import { deleteQuestionRequest } from "@/lib/mcq-client";

function trigger() {
  return screen.getByRole("button", { name: /actions for capitals of europe/i });
}

// Base UI opens its menu from pointerdown, which jsdom cannot emulate faithfully, so these
// tests drive the trigger from the keyboard. That is a real path a teacher can take, and the
// mouse path is exercised in the manual walkthrough instead.
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  trigger().focus();
  await user.keyboard("{Enter}");
  await screen.findByRole("menuitem", { name: /edit/i });
}

async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  await openMenu(user);
  await user.click(screen.getByRole("menuitem", { name: /delete/i }));
  return screen.findByRole("alertdialog");
}

function renderActions() {
  return render(
    <QuestionActions questionId="question-1" questionName="Capitals of Europe" />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteQuestionRequest).mockResolvedValue({
    ok: true,
    data: { ok: true },
  } as never);
});

describe("QuestionActions menu", () => {
  it("uses a single actions control per question", () => {
    renderActions();

    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
  });

  it("keeps the menu closed until it is opened", () => {
    renderActions();

    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("offers edit, preview and delete once opened", async () => {
    const user = userEvent.setup();
    renderActions();

    await openMenu(user);

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Edit", "Preview", "Delete"]);
  });

  it("points edit and preview at that question's pages", async () => {
    const user = userEvent.setup();
    renderActions();

    await openMenu(user);

    expect(
      screen
        .getByRole("menuitem", { name: /edit/i })
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/mcq/question-1/edit");
    expect(
      screen
        .getByRole("menuitem", { name: /preview/i })
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/mcq/question-1/preview");
  });
});

describe("QuestionActions delete", () => {
  it("does not delete straight from the menu", async () => {
    const user = userEvent.setup();
    renderActions();

    await openDeleteDialog(user);

    expect(deleteQuestionRequest).not.toHaveBeenCalled();
  });

  it("asks for confirmation and names the question being deleted", async () => {
    const user = userEvent.setup();
    renderActions();

    const dialog = await openDeleteDialog(user);

    expect(dialog.textContent).toContain("Capitals of Europe");
  });

  it("deletes nothing when the teacher backs out", async () => {
    const user = userEvent.setup();
    renderActions();

    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(deleteQuestionRequest).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("deletes and refreshes the list once confirmed", async () => {
    const user = userEvent.setup();
    renderActions();

    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(deleteQuestionRequest).toHaveBeenCalledWith("question-1"),
    );
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  });

  it("reports a failed delete instead of pretending it worked", async () => {
    vi.mocked(deleteQuestionRequest).mockResolvedValue({
      ok: false,
      formError: "Could not delete question",
    } as never);

    const user = userEvent.setup();
    renderActions();

    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByText("Could not delete question")).toBeTruthy();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("does not fire two deletes from a double click", async () => {
    const user = userEvent.setup();
    renderActions();

    await openDeleteDialog(user);
    const confirm = screen.getByRole("button", { name: /^delete$/i });
    await user.click(confirm);
    await user.click(confirm).catch(() => {});

    await waitFor(() =>
      expect(deleteQuestionRequest).toHaveBeenCalledTimes(1),
    );
  });
});
