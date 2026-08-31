/**
 * The two failure modes this tool has, and nothing else.
 *
 * Bundle stats files are machine-generated but they arrive from
 * somewhere else — a CI artefact, a colleague, a tarball — so "this is
 * not the file you think it is" is the common case, not an edge case.
 * Every rejection therefore has to say which key was wrong and what was
 * found there, because the user cannot read a 12 MB JSON file to check.
 */

/** The input could not be understood as a bundle stats file. */
export class MetafileError extends Error {
  override readonly name = "MetafileError";
}

/** The command line asked for something that does not exist in the bundle. */
export class QueryError extends Error {
  override readonly name = "QueryError";

  /** Candidate values worth showing the user, when there are any. */
  readonly suggestions: readonly string[];

  constructor(message: string, suggestions: readonly string[] = []) {
    super(message);
    this.suggestions = suggestions;
  }
}

/**
 * True for the errors this tool raises on purpose.
 *
 * The CLI prints these as one clean line; anything else is a bug and
 * gets a stack trace, because hiding an unexpected `TypeError` behind a
 * friendly message is how bugs survive.
 */
export function isExpectedError(error: unknown): error is MetafileError | QueryError {
  return error instanceof MetafileError || error instanceof QueryError;
}
