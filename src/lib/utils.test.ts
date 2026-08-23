import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins distinct class names", () => {
    expect(cn("rounded", "border")).toBe("rounded border");
  });

  it("keeps the last of two conflicting Tailwind utilities", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values instead of rendering them", () => {
    expect(cn("border", false && "hidden", undefined, "p-2")).toBe("border p-2");
  });
});
