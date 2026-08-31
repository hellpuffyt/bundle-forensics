/**
 * The published version, as a compile-time constant.
 *
 * Reading it out of `package.json` at runtime would mean either a JSON
 * import assertion (still unstable across the Node versions this
 * supports) or resolving a path relative to `dist/`, which breaks under
 * bundling. A constant costs one line and cannot fail; `test/meta.test.ts`
 * asserts it still matches `package.json`, so it cannot drift either.
 */
export const VERSION = "0.1.0";
