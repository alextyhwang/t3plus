// What the task, calendar and photo feeds share: their error type and how
// they clean text from a remote response. Each feed keeps its own wording.

/** A failed feed request. `status` is the HTTP status, 0 for no response. */
export class RemoteFeedError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** Collapses whitespace and caps the length; anything but a string is "". */
export const clean = (value, max = 160) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The message for a feed load that came back without data (not 401/403,
 * which each feed words itself). `service` is lower case ("task service").
 */
export function loadFailureMessage(response, { service, notFound, unreachable, subject, detailMax }) {
  const status = Number(response?.status) || 0;
  const detail = clean(response?.error, detailMax);
  const suffix = detail ? ` ${detail}` : "";
  if (status === 404) return notFound;
  if (status >= 500) return `${service[0].toUpperCase()}${service.slice(1)} returned HTTP ${status}. Try again later.${suffix}`;
  if (status === 0) return detail ? `Could not reach the ${service}: ${detail}` : `Could not reach the ${service}. ${unreachable}`;
  return `Could not load ${subject} (HTTP ${status}).${suffix}`;
}
