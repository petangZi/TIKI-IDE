// src/api/respond.mjs
// Uniform HTTP responses + error normalisation.
export class ApiError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST", details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(res, status, value, headers = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

export function sendError(res, error) {
  const status = error?.status || 500;
  const code = error?.code || (status === 500 ? "INTERNAL" : "ERROR");
  sendJson(res, status, { error: error?.message || "Internal server error", code });
}

/** Normalise thrown values into ApiError. */
export function asApiError(error) {
  if (error instanceof ApiError) return error;
  if (error?.status) return new ApiError(error.message, error.status, error.code || "ERROR");
  return new ApiError(error?.message || "Internal server error", 500, "INTERNAL");
}
