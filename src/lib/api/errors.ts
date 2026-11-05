/** Errors that are safe to show. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export const notFound = (what = "That item") => new ApiError(404, "not_found", `${what} wasn't found.`);
