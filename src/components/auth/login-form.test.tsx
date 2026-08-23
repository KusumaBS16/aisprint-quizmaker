import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { LoginForm } from "./login-form";

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
    jsonResponse(200, { user: { id: "abc", username: "KusumaBS" } }),
  );
});

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  username = "KusumaBS",
  password = "correct-horse-battery",
) {
  if (username) {
    await user.type(screen.getByLabelText("Username"), username);
  }
  if (password) {
    await user.type(screen.getByLabelText("Password"), password);
  }
}

function submit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm", () => {
  it("renders exactly a username and a password field", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(document.querySelectorAll("input")).toHaveLength(2);
  });

  it("has no remember me checkbox, which would be a lie without sessions", () => {
    render(<LoginForm />);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/remember me/i)).toBeNull();
  });

  it("masks the password field", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Password").getAttribute("type")).toBe(
      "password",
    );
  });

  it("posts the username and password to the login endpoint", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      username: "KusumaBS",
      password: "correct-horse-battery",
    });
  });

  it("sends the username with its casing intact", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user, "KuSuMa");
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).username).toBe("KuSuMa");
  });

  it("redirects to /mcq on success", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/mcq"));
  });

  it("renders a 401 as exactly 'Invalid credentials'", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: "Invalid credentials" }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user, "KusumaBS", "wrong-password");
    await submit(user);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invalid credentials");
    expect(push).not.toHaveBeenCalled();
  });

  it("attaches the 401 to neither input, so it does not hint at which was wrong", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: "Invalid credentials" }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user, "KusumaBS", "wrong-password");
    await submit(user);

    const message = await screen.findByText("Invalid credentials");
    expect(message.closest("[data-slot=field]")).toBeNull();
    expect(
      screen.getByLabelText("Username").getAttribute("aria-invalid"),
    ).not.toBe("true");
    expect(
      screen.getByLabelText("Password").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("shows only one message for a failed login, not one per field", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: "Invalid credentials" }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user, "KusumaBS", "wrong-password");
    await submit(user);

    await screen.findByText("Invalid credentials");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("blocks an empty submit locally without calling the API", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await submit(user);

    expect(await screen.findByText("Username is required")).toBeTruthy();
    expect(screen.getByText("Password is required")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies none of register's length rules, so a short credential reaches the server", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: "Invalid credentials" }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user, "k", "s");
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Invalid credentials")).toBeTruthy();
  });

  it("re-enables the button after a 401 so the user can try again", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: "Invalid credentials" }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user, "KusumaBS", "wrong-password");
    await submit(user);

    await screen.findByText("Invalid credentials");
    expect(
      (screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("clears a previous error when the next attempt succeeds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: "Invalid credentials" }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user, "KusumaBS", "wrong");
    await submit(user);
    await screen.findByText("Invalid credentials");

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await submit(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/mcq"));
    expect(screen.queryByText("Invalid credentials")).toBeNull();
  });

  it("shows the server's message for a 500", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: "Could not sign in" }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillForm(user);
    await submit(user);

    expect(await screen.findByText("Could not sign in")).toBeTruthy();
  });

  it("offers a link to the register page", () => {
    render(<LoginForm />);

    expect(
      screen.getByRole("link", { name: /register/i }).getAttribute("href"),
    ).toBe("/register");
  });
});
