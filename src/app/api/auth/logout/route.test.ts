// @vitest-environment node
import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("returns 200 with a plain success acknowledgement", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("succeeds every time, since there is no state to check or clear", async () => {
    const first = await POST();
    const second = await POST();

    expect([first.status, second.status]).toEqual([200, 200]);
    await expect(second.json()).resolves.toEqual({ success: true });
  });

  it("sets no cookie, because the sprint issues none to clear", async () => {
    const response = await POST();

    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
