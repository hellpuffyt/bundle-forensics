/**
 * The structural guards.
 *
 * Every assertion here is about the *message*, not just the throw: the
 * whole point of these helpers is that a 12 MB stats file with one bad
 * key produces a sentence naming that key.
 */

import { describe, expect, it } from "vitest";

import { MetafileError } from "../src/errors.js";
import {
  asArray,
  asBytes,
  asObject,
  asString,
  optionalBoolean,
  optionalString,
  parseJson,
} from "../src/validate.js";

describe("parseJson", () => {
  it("returns the parsed value for well-formed JSON", () => {
    expect(parseJson('{"a":1}', "x")).toEqual({ a: 1 });
  });

  it("accepts any JSON value, not only objects", () => {
    expect(parseJson("[1,2]", "x")).toEqual([1, 2]);
    expect(parseJson("null", "x")).toBeNull();
  });

  it("wraps a syntax error, naming the source", () => {
    expect(() => parseJson("{oops", "meta.json")).toThrow(MetafileError);
    expect(() => parseJson("{oops", "meta.json")).toThrow(/^meta\.json is not valid JSON: /);
  });
});

describe("asObject", () => {
  it("passes plain objects through", () => {
    const value = { a: 1 };
    expect(asObject(value, "here")).toBe(value);
  });

  it("rejects an array, which typeof calls an object", () => {
    expect(() => asObject([], "here")).toThrow("here must be an object, found an array");
  });

  it("rejects null, which typeof also calls an object", () => {
    expect(() => asObject(null, "here")).toThrow("here must be an object, found null");
  });

  it("names the type it actually found", () => {
    expect(() => asObject("s", "here")).toThrow("here must be an object, found a string");
    expect(() => asObject(1, "here")).toThrow("here must be an object, found a number");
  });
});

describe("asArray", () => {
  it("passes arrays through", () => {
    expect(asArray([1], "here")).toEqual([1]);
  });

  it("rejects an object", () => {
    expect(() => asArray({}, "here")).toThrow("here must be an array, found a object");
  });
});

describe("asBytes", () => {
  it("accepts zero and positive numbers", () => {
    expect(asBytes(0, "here")).toBe(0);
    expect(asBytes(1024, "here")).toBe(1024);
  });

  it("rejects negative sizes, which are always a bug upstream", () => {
    expect(() => asBytes(-1, "here")).toThrow("here must be a non-negative number, found -1");
  });

  it("rejects NaN and Infinity by value, not by type", () => {
    expect(() => asBytes(Number.NaN, "here")).toThrow("found NaN");
    expect(() => asBytes(Number.POSITIVE_INFINITY, "here")).toThrow("found Infinity");
  });

  it("rejects a numeric string, because sizes arrive as numbers", () => {
    expect(() => asBytes("100", "here")).toThrow("here must be a non-negative number, found a string");
  });

  it("rejects a missing value", () => {
    expect(() => asBytes(undefined, "here")).toThrow("found a undefined");
  });
});

describe("asString", () => {
  it("passes strings through, including the empty one", () => {
    expect(asString("", "here")).toBe("");
    expect(asString("a", "here")).toBe("a");
  });

  it("rejects a number", () => {
    expect(() => asString(3, "here")).toThrow("here must be a string, found a number");
  });
});

describe("optionalString", () => {
  it("allows absence", () => {
    expect(optionalString(undefined, "here")).toBeUndefined();
  });

  it("still rejects a present value of the wrong type", () => {
    expect(() => optionalString(3, "here")).toThrow(MetafileError);
  });

  it("does not treat null as absence", () => {
    expect(() => optionalString(null, "here")).toThrow("found null");
  });
});

describe("optionalBoolean", () => {
  it("falls back when absent", () => {
    expect(optionalBoolean(undefined, "here", true)).toBe(true);
    expect(optionalBoolean(undefined, "here", false)).toBe(false);
  });

  it("returns a present boolean", () => {
    expect(optionalBoolean(false, "here", true)).toBe(false);
  });

  it("rejects a truthy non-boolean rather than coercing it", () => {
    expect(() => optionalBoolean("yes", "here", false)).toThrow(
      "here must be a boolean, found a string",
    );
  });
});
