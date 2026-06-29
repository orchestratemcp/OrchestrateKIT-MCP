import { describe, it, expect } from "vitest";
import { contentFingerprint } from "../../src/registry/contentFingerprint.js";
import { readRawEntries } from "../../src/registry/registryLoader.js";
import type { RawEntries } from "../../src/registry/registryAssembly.js";

describe("contentFingerprint (MAR-220)", () => {
  it("is deterministic across repeated calls on the same source", () => {
    const a = contentFingerprint(readRawEntries());
    const b = contentFingerprint(readRawEntries());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("ignores file mtimes — the same content yields the same fingerprint", () => {
    const raw = readRawEntries();
    const bumped: RawEntries = {
      components: raw.components.map((r) => ({ ...r, fileMtime: new Date(0) })),
      edges: raw.edges.map((r) => ({ ...r, fileMtime: new Date(0) })),
      stacks: raw.stacks.map((r) => ({ ...r, fileMtime: new Date(0) })),
      routes: raw.routes.map((r) => ({ ...r, fileMtime: new Date(0) })),
      playbooks: raw.playbooks.map((r) => ({ ...r, fileMtime: new Date(0) })),
      workers: raw.workers.map((r) => ({ ...r, fileMtime: new Date(0) })),
    };
    expect(contentFingerprint(bumped)).toBe(contentFingerprint(raw));
  });

  it("is insensitive to entity ordering (sorts by id)", () => {
    const raw = readRawEntries();
    const shuffled: RawEntries = {
      ...raw,
      components: [...raw.components].reverse(),
      edges: [...raw.edges].reverse(),
    };
    expect(contentFingerprint(shuffled)).toBe(contentFingerprint(raw));
  });

  it("changes when entity content changes", () => {
    const raw = readRawEntries();
    const before = contentFingerprint(raw);
    const mutated: RawEntries = {
      ...raw,
      components: raw.components.map((r, i) =>
        i === 0 ? { ...r, data: { ...r.data, name: `${r.data.name} (edited)` } } : r,
      ),
    };
    expect(contentFingerprint(mutated)).not.toBe(before);
  });
});
