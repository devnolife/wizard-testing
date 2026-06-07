import { describe, it, expect, afterAll } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  parseEnv,
  envAccounts,
  extractAccountsFromText,
  maskSecret,
  detectSeedAccounts,
} from "@/server/tools/seed";

const tmpDirs: string[] = [];
function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "wizard-seed-"));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("parseEnv", () => {
  it("parses keys, strips quotes and inline comments", () => {
    const env = parseEnv(
      [
        "export FOO=bar",
        'ADMIN_EMAIL="admin@example.com"',
        "ADMIN_PASSWORD = secret123 # the admin pw",
        "EMPTY=",
        "# a comment",
      ].join("\n"),
    );
    expect(env.FOO).toBe("bar");
    expect(env.ADMIN_EMAIL).toBe("admin@example.com");
    expect(env.ADMIN_PASSWORD).toBe("secret123");
    expect(env.EMPTY).toBe("");
  });
});

describe("envAccounts", () => {
  it("pairs identifier/secret env vars by prefix", () => {
    const accounts = envAccounts(
      {
        ADMIN_EMAIL: "admin@example.com",
        ADMIN_PASSWORD: "adminpw",
        USER_USERNAME: "alice",
        USER_PASSWORD: "alicepw",
      },
      ".env",
    );
    expect(accounts).toHaveLength(2);
    const admin = accounts.find((a) => a.identifier === "admin@example.com");
    expect(admin?.secret).toBe("adminpw");
    expect(admin?.role).toBe("admin");
  });

  it("falls back to the single secret when there is exactly one", () => {
    const accounts = envAccounts(
      { TEST_EMAIL: "t@example.com", SEED_PASSWORD: "pw" },
      ".env.test",
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].secret).toBe("pw");
  });
});

describe("extractAccountsFromText", () => {
  it("extracts identifier-then-password from object literals", () => {
    const accounts = extractAccountsFromText(
      `const admin = { email: "admin@site.com", role: "admin", password: "hunter2" };`,
      "seed.ts",
    );
    expect(accounts).toContainEqual(
      expect.objectContaining({ identifier: "admin@site.com", secret: "hunter2" }),
    );
  });

  it("extracts password-then-identifier order", () => {
    const accounts = extractAccountsFromText(
      `{ password: "topsecret", username: "bob" }`,
      "fixtures.ts",
    );
    expect(accounts).toContainEqual(
      expect.objectContaining({ identifier: "bob", secret: "topsecret" }),
    );
  });

  it("extracts email/password tuples from SQL VALUES", () => {
    const accounts = extractAccountsFromText(
      `INSERT INTO users (email, password) VALUES ('jane@example.com', 'janepw');`,
      "seed.sql",
    );
    expect(accounts).toContainEqual(
      expect.objectContaining({ identifier: "jane@example.com", secret: "janepw" }),
    );
  });

  it("rejects placeholder/env-reference secrets", () => {
    const accounts = extractAccountsFromText(
      [
        `{ email: "a@b.com", password: process.env.PW }`,
        `{ email: "c@d.com", password: "changeme" }`,
        `{ email: "e@f.com", password: "<your-password>" }`,
      ].join("\n"),
      "x.ts",
    );
    expect(accounts).toHaveLength(0);
  });
});

describe("maskSecret", () => {
  it("masks the middle of a secret", () => {
    expect(maskSecret("hunter2")).toBe("h•••••2");
    expect(maskSecret("ab")).toBe("••");
  });
});

describe("detectSeedAccounts", () => {
  it("collects accounts from .env and seed files in a project", () => {
    const dir = makeProject({
      ".env": "ADMIN_EMAIL=admin@example.com\nADMIN_PASSWORD=adminpw\n",
      "prisma/seed.ts": `const user = { email: "user@example.com", password: "userpw" };`,
    });
    const accounts = detectSeedAccounts(dir);
    const ids = accounts.map((a) => a.identifier);
    expect(ids).toContain("admin@example.com");
    expect(ids).toContain("user@example.com");
  });

  it("never throws for a missing project path", () => {
    expect(detectSeedAccounts(join(tmpdir(), "does-not-exist-xyz"))).toEqual([]);
  });
});
