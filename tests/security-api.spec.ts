import { test, expect } from "@playwright/test";

test("local API refuses hostile origins, cross-site requests and mutation commands", async ({
  request,
}) => {
  for (const headers of [
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
    { Host: "evil.example" },
  ] as Record<string, string>[]) {
    const response = await request.post("/api/query", {
      data: { command: "snapshot", refresh: false },
      headers,
    });
    expect(response.status()).toBe(403);
  }
  for (const command of ["install", "remove", "upgrade", "execute", "removal_apply"]) {
    const response = await request.post("/api/query", { data: { command, name: "pacman" } });
    expect(response.ok()).toBe(false);
  }
});

test("saved lookup enforces request limits and distinguishes missing packages", async ({
  request,
}) => {
  const response = await request.post("/api/query", {
    data: { command: "packages_by_ids", ids: ["missing/archhub-fixture"] },
  });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    items: [],
    missingIds: ["missing/archhub-fixture"],
  });
  for (const ids of [Array(33).fill("core/fixture"), ["x".repeat(400)], [""]]) {
    const rejected = await request.post("/api/query", {
      data: { command: "packages_by_ids", ids },
    });
    expect(rejected.status()).toBe(400);
  }
  const oversized = await request.post("/api/query", {
    data: { command: "packages_by_ids", ids: ["x".repeat(20_000)] },
  });
  expect(oversized.status()).toBe(413);
});
