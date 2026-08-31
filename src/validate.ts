/**
 * Structural checks for untrusted JSON.
 *
 * These exist so that a malformed stats file produces one sentence
 * naming the offending key, rather than a `TypeError: Cannot read
 * properties of undefined` thrown three call frames deep inside the
 * analysis. Every helper takes the path it is checking so the message
 * can point at it.
 */

import { MetafileError } from "./errors.js";

/** A JSON object with unknown values — the only shape we ever assume. */
export type JsonObject = Record<string, unknown>;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** Parses JSON, turning a syntax error into a `MetafileError`. */
export function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new MetafileError(`${where} is not valid JSON: ${detail}`);
  }
}

export function asObject(value: unknown, where: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MetafileError(`${where} must be an object, found ${describe(value)}`);
  }
  return value as JsonObject;
}

export function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MetafileError(`${where} must be an array, found ${describe(value)}`);
  }
  return value;
}

/** A finite, non-negative byte count. Sizes that are `NaN` or negative are lies. */
export function asBytes(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MetafileError(
      `${where} must be a non-negative number, found ${
        typeof value === "number" ? String(value) : describe(value)
      }`,
    );
  }
  return value;
}

export function asString(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new MetafileError(`${where} must be a string, found ${describe(value)}`);
  }
  return value;
}

/** Reads an optional string, rejecting a wrong type but allowing absence. */
export function optionalString(
  value: unknown,
  where: string,
): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, where);
}

/** Reads an optional boolean, defaulting when absent. */
export function optionalBoolean(
  value: unknown,
  where: string,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new MetafileError(`${where} must be a boolean, found ${describe(value)}`);
  }
  return value;
}
