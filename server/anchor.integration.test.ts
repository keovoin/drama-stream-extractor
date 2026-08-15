import { describe, expect, it } from "vitest";

describe("Anchor Browser credential", () => {
  it("authenticates with the configured server credential", async () => {
    const apiKey = process.env.ANCHOR_API_KEY;
    expect(apiKey).toBeTruthy();

    const response = await fetch("https://api.anchorbrowser.io/v1/billing", {
      headers: { "anchor-api-key": apiKey! },
    });

    expect(response.ok).toBe(true);
  }, 30_000);
});
