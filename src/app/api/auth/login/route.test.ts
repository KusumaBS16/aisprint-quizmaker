// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// findUserByUsername is the only D1 call login makes. toPublicUser stays real so the
// response-shape assertions test the actual mapper, and @/lib/password is not mocked at all -
// these tests verify against a hash produced by the real Phase 4 implementation.
vi.mock("@/lib/services/user-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/user-service")>();
  return { ...actual, findUserByUsername: vi.fn() };
});

import { hashPassword } from "@/lib/password";
import {
  findUserByUsername,
  type UserRow,
} from "@/lib/services/user-service";

import { POST } from "./route";

const PLAINTEXT = "correct-horse-battery";
const STORED_HASH = await hashPassword(PLAINTEXT);

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

  it("looks the user up by the submitted username", async () => {
    await POST(postRequest({ username: "Kusuma", password: PLAINTEXT }));

    expect(findUserByUsername).toHaveBeenCalledWith("Kusuma");
  });

  it("looks the username up with its casing intact", async () => {
    await POST(postRequest({ username: "  KusumaBS  ", password: PLAINTEXT }));

    expect(findUserByUsername).toHaveBeenCalledWith("KusumaBS");
  });

  it("accepts a password that differs from the stored one only in case as wrong", async () => {
    const response = await POST(
      postRequest({ username: "Kusuma", password: PLAINTEXT.toUpperCase() }),
    );

    expect(response.status).toBe(401);
  });

  it("returns no password hash anywhere in a success response", async () => {
    const body = await (
      await POST(postRequest({ username: "Kusuma", password: PLAINTEXT }))
    ).text();

    expect(body).not.toContain("password_hash");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain(STORED_HASH);
    expect(body).not.toContain(PLAINTEXT);
    expect(body).not.toContain("pbkdf2");
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
    const body = await (
      await POST(postRequest({ username: "Kusuma", password: "wrong" }))
    ).text();

    expect(body).not.toContain("username");
    expect(body).not.toContain("password");
    expect(body).not.toContain("Kusuma");
  });

  it("does not attempt verification when there is no user, or it would 500 not 401", async () => {
    // With no row there is no hash to parse. A route that reached for one anyway would throw
    // on the missing value and surface as 500, so the 401 is the evidence it stopped first.
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ username: "nobody", password: PLAINTEXT }),
    );

    expect(response.status).toBe(401);
  });

  it("does not log anyone in via their email address, since email is not a credential", async () => {
    vi.mocked(findUserByUsername).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ username: "kusuma@example.com", password: PLAINTEXT }),
    );

    expect(response.status).toBe(401);
    expect(findUserByUsername).toHaveBeenCalledWith("kusuma@example.com");
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

  it("returns 500 for a corrupt stored hash rather than reporting bad credentials", async () => {
    // A row whose password_hash is not in the pbkdf2-sha256 format is a data problem, not a
    // failed login. Real verifyPassword throws on it, and the route must not flatten that
    // into 401 - that would tell the user their correct password was wrong.
    vi.mocked(findUserByUsername).mockResolvedValue({
      ...storedUser,
      password_hash: "not-a-hash-at-all",
    });

    const response = await POST(
      postRequest({ username: "Kusuma", password: PLAINTEXT }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not sign in",
    });
  });

  it("never answers with 409", async () => {
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
