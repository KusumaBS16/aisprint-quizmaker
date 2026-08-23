// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { STORED_HASH } = vi.hoisted(() => ({
  STORED_HASH: "pbkdf2-sha256$100000$ZmFrZXNhbHQ=$ZmFrZWtleQ==",
}));

// findUserByUsername is the only D1 call login makes. toPublicUser stays real so the
// response-shape assertions test the actual mapper.
vi.mock("@/lib/services/user-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/user-service")>();
  return { ...actual, findUserByUsername: vi.fn() };
});

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async () => STORED_HASH),
  verifyPassword: vi.fn(async () => true),
}));

import { verifyPassword } from "@/lib/password";
import {
  findUserByUsername,
  type UserRow,
} from "@/lib/services/user-service";

import { POST } from "./route";

const PLAINTEXT = "correct-horse-battery";

const storedUser: UserRow = {
  id: "3f7fd8dcf39b789bc0180d39bd9ab94e",
  first_name: "Kusuma",
  last_name: "Reddy",
  username: "Kusuma",
  email: "kusuma@example.com",
  password_hash: STORED_HASH,
  created_at: "2026-08-23 12:04:11",
  updated_at: "2026-08-23 12:04:11",
};

function postRequest(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(findUserByUsername).mockResolvedValue(storedUser);
  vi.mocked(verifyPassword).mockResolvedValue(true);
});

describe("POST /api/auth/login", () => {
  it("returns 200 with the same wrapped user shape register returns", async () => {
    const response = await POST(
      postRequest({ username: "Kusuma", password: PLAINTEXT }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: storedUser.id,
        firstName: "Kusuma",
        lastName: "Reddy",
        username: "Kusuma",
        email: "kusuma@example.com",
        createdAt: "2026-08-23 12:04:11",
        updatedAt: "2026-08-23 12:04:11",
      },
    });
  });

  it("verifies the submitted password against the stored hash", async () => {
    await POST(postRequest({ username: "Kusuma", password: PLAINTEXT }));

    expect(findUserByUsername).toHaveBeenCalledWith("Kusuma");
    expect(verifyPassword).toHaveBeenCalledWith(PLAINTEXT, STORED_HASH);
  });

  it("looks the username up with its casing intact", async () => {
    await POST(postRequest({ username: "  KusumaBS  ", password: PLAINTEXT }));

    expect(findUserByUsername).toHaveBeenCalledWith("KusumaBS");
  });

  it("returns no password hash anywhere in a success response", async () => {
    const body = await (
      await POST(postRequest({ username: "Kusuma", password: PLAINTEXT }))
    ).text();

    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain(STORED_HASH);
    expect(body).not.toContain(PLAINTEXT);
  });

  it("returns 401 Invalid credentials for an unknown username", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ username: "nobody", password: PLAINTEXT }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid credentials",
    });
  });

  it("returns 401 Invalid credentials for a wrong password", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await POST(
      postRequest({ username: "Kusuma", password: "wrong-password" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid credentials",
    });
  });

  it("answers an unknown username and a wrong password byte-identically", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);
    const unknownUser = await POST(
      postRequest({ username: "nobody", password: PLAINTEXT }),
    );
    const unknownBody = await unknownUser.text();

    vi.mocked(findUserByUsername).mockResolvedValue(storedUser);
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const wrongPassword = await POST(
      postRequest({ username: "Kusuma", password: "wrong-password" }),
    );
    const wrongBody = await wrongPassword.text();

    expect(unknownBody).toBe(wrongBody);
    expect(unknownUser.status).toBe(wrongPassword.status);
    expect(unknownUser.headers.get("content-type")).toBe(
      wrongPassword.headers.get("content-type"),
    );
  });

  it("names no field in either 401", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const body = await (
      await POST(postRequest({ username: "Kusuma", password: "wrong" }))
    ).text();

    expect(body).not.toContain("username");
    expect(body).not.toContain("password");
    expect(body).not.toContain("Kusuma");
  });

  it("does not verify a password when there is no user to verify against", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);

    await POST(postRequest({ username: "nobody", password: PLAINTEXT }));

    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("does not log anyone in via their email address, since email is not a credential", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ username: "kusuma@example.com", password: PLAINTEXT }),
    );

    expect(response.status).toBe(401);
    expect(findUserByUsername).toHaveBeenCalledWith("kusuma@example.com");
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("treats a credential register would have rejected as a 401, not a 400", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);

    const response = await POST(postRequest({ username: "k", password: "s" }));

    expect(response.status).toBe(401);
    expect(findUserByUsername).toHaveBeenCalledWith("k");
  });

  it("returns 400 Validation failed for a missing field", async () => {
    const response = await POST(postRequest({ username: "Kusuma" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
      fields: { password: "Password is required" },
    });
    expect(findUserByUsername).not.toHaveBeenCalled();
  });

  it("returns 400 Validation failed for a body that is not JSON", async () => {
    const response = await POST(postRequest("not json at all"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
    });
  });

  it("returns 500 Could not sign in when the lookup throws", async () => {
    vi.mocked(findUserByUsername).mockRejectedValue(
      new Error("D1_ERROR: database is locked"),
    );

    const response = await POST(
      postRequest({ username: "Kusuma", password: PLAINTEXT }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not sign in",
    });
  });

  it("returns 500 when verification throws rather than reporting bad credentials", async () => {
    vi.mocked(verifyPassword).mockRejectedValue(new Error("malformed hash"));

    const response = await POST(
      postRequest({ username: "Kusuma", password: PLAINTEXT }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not sign in",
    });
  });

  it("never answers with 409", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await POST(
      postRequest({ username: "Kusuma", password: "wrong" }),
    );

    expect(response.status).not.toBe(409);
  });

  it("keeps the plaintext password out of the logs on the failure path", async () => {
    vi.mocked(findUserByUsername).mockRejectedValue(new Error("D1_ERROR: boom"));

    await POST(postRequest({ username: "Kusuma", password: PLAINTEXT }));

    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      PLAINTEXT,
    );
  });
});
