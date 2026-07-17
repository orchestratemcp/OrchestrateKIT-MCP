import { describe, expect, it } from "vitest";
import {
  isLoopbackHost,
  isPublicBindHost,
  parseBooleanFlag,
  resolveHttpBindConfig,
} from "../../src/lib/httpBindConfig.js";

describe("HTTP bind config local-only guard", () => {
  it("defaults to loopback even when a hosting-style PORT is present", () => {
    expect(resolveHttpBindConfig({ PORT: "4000" })).toEqual({
      host: "127.0.0.1",
      port: 4000,
      publicBindAllowed: false,
    });
  });

  it("allows explicit loopback hosts", () => {
    expect(resolveHttpBindConfig({ HOST: "localhost" }).host).toBe("localhost");
    expect(resolveHttpBindConfig({ HOST: "::1" }).host).toBe("::1");
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
  });

  it("blocks public interface binding unless explicitly allowed", () => {
    expect(() => resolveHttpBindConfig({ HOST: "0.0.0.0" })).toThrow(/Refusing to bind/);
    expect(() => resolveHttpBindConfig({ HOST: "::" })).toThrow(/Refusing to bind/);
    expect(isPublicBindHost("0.0.0.0")).toBe(true);
  });

  it("allows public interface binding with a deliberate opt-in flag", () => {
    expect(
      resolveHttpBindConfig({
        HOST: "0.0.0.0",
        PORT: "8080",
        ORCHESTRATEKIT_ALLOW_PUBLIC_BIND: "1",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 8080,
      publicBindAllowed: true,
    });
  });

  it("parses common truthy values but treats absent or arbitrary values as false", () => {
    expect(parseBooleanFlag("1")).toBe(true);
    expect(parseBooleanFlag("true")).toBe(true);
    expect(parseBooleanFlag("yes")).toBe(true);
    expect(parseBooleanFlag("on")).toBe(true);
    expect(parseBooleanFlag(undefined)).toBe(false);
    expect(parseBooleanFlag("please")).toBe(false);
  });

  it("rejects invalid ports", () => {
    expect(() => resolveHttpBindConfig({ PORT: "0" })).toThrow(/Invalid PORT/);
    expect(() => resolveHttpBindConfig({ PORT: "70000" })).toThrow(/Invalid PORT/);
    expect(() => resolveHttpBindConfig({ PORT: "abc" })).toThrow(/Invalid PORT/);
  });
});
