/** An error with a status and a message that is safe to show, like the real portal API returns. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new ApiError(400, m);
export const unauthorized = (m = 'Please sign in.') => new ApiError(401, m);
export const forbidden = (m: string) => new ApiError(403, m);
export const notFound = (m: string) => new ApiError(404, m);
export const conflict = (m: string) => new ApiError(409, m);
export const unavailable = (m: string) => new ApiError(503, m);
