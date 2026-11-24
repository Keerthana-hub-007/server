// An error that knows its HTTP status and a short code the front end can read.
// `message` is written for the learner: it says what happened and what to do.
export class ApiError extends Error {
  constructor(status, code, message, { retryAfter } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
