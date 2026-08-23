import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { RegisterForm } from "./register-form";

const VALID = {
  "First name": "Kusuma",
  "Last name": "Reddy",
  Username: "KusumaBS",
  Email: "kusuma@example.com",
  Password: "correct-horse-battery",
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    jsonResponse(201, { user: { id: "abc", username: "KusumaBS" } }),
  );
});

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<typeof VALID> = {},
) {
  const values = { ...VALID, ...overrides };
  for (const [label, value] of Object.entries(values)) {
    const input = screen.getByLabelText(label);
    await user.clear(input);
    if (value) {
      await user.type(input, value);
    }
  }
}

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: /create account/i }));
}

describe("RegisterForm", () => {
  it("renders all five fields and no others", () => {
    render(<RegisterForm />);

    for (const label of Object.keys(VALID)) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.queryByLabelText(/confirm/i)).toBeNull();
    expect(document.querySelectorAll("input")).toHaveLength(5);
  });

  it("masks the password field and leaves the others as text", () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText("Password").getAttribute("type")).toBe(
      "password",
    );
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
    expect(screen.getByLabelText("Username").getAttribute("type")).toBe("text");
  });

  it("posts all five fields to the register endpoint", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/auth/register");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      firstName: "Kusuma",
      lastName: "Reddy",
      username: "KusumaBS",
      email: "kusuma@example.com",
      password: "correct-horse-battery",
    });
  });

  it("redirects to /mcq on success, not to /login", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/mcq"));
    expect(push).not.toHaveBeenCalledWith("/login");
  });

  it("keeps the submit button disabled after a successful submit, so a double click cannot register twice", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(push).toHaveBeenCalled());
    const button = screen.getByRole("button", { name: /creating account/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await user.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a short password locally and never calls the API", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user, { Password: "short" });
    await submit(user);

    expect(await screen.findByText("Must be at least 8 characters")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a malformed email locally", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user, { Email: "not-an-email" });
    await submit(user);

    expect(
      await screen.findByText("Must be a valid email address"),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a username under three characters locally", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user, { Username: "ku" });
    await submit(user);

    expect(
      await screen.findByText("Must be between 3 and 32 characters"),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks an empty first name and last name locally", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user, { "First name": "", "Last name": "" });
    await submit(user);

    expect(await screen.findByText("First name is required")).toBeTruthy();
    expect(screen.getByText("Last name is required")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a server 400's fields message on the matching input", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: "Validation failed",
        fields: { email: "Must be a valid email address" },
      }),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    const message = await screen.findByText("Must be a valid email address");
    const emailField = screen.getByLabelText("Email").closest("[data-slot=field]");
    expect(emailField?.contains(message)).toBe(true);
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("renders 'Username already taken' at form level, attached to no input", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "Username already taken" }),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    const message = await screen.findByText("Username already taken");
    expect(message.closest("[data-slot=field]")).toBeNull();
    expect(
      screen.getByLabelText("Username").getAttribute("aria-invalid"),
    ).not.toBe("true");
    expect(push).not.toHaveBeenCalled();
  });

  it("renders 'Email already registered' at form level too", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "Email already registered" }),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    const message = await screen.findByText("Email already registered");
    expect(message.closest("[data-slot=field]")).toBeNull();
  });

  it("re-enables the button after a rejected submit so the user can correct and retry", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "Username already taken" }),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    await screen.findByText("Username already taken");
    const button = screen.getByRole("button", { name: /create account/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's message for a 500 rather than inventing one", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: "Could not create account" }),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    expect(await screen.findByText("Could not create account")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("reports a network failure instead of hanging on a disabled button", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    expect(
      await screen.findByText(/could not reach the server/i),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("announces errors to assistive technology", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "Username already taken" }),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await fillForm(user);
    await submit(user);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Username already taken");
  });

  it("offers a link to the login page", () => {
    render(<RegisterForm />);

    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link.getAttribute("href")).toBe("/login");
  });
});
