import { API_URL } from "./config";
import { getFocusUserId } from "./focusUser";

function buildHeaders(headers = {}) {
  return {
    "Content-Type": "application/json",
    "x-focus-user": getFocusUserId(),
    ...headers,
  };
}

async function request(path, { method = "GET", body, headers } = {}) {
  const response = await fetch(`${API_URL}/api/focus${path}`, {
    method,
    headers: buildHeaders(headers),
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || `Focus API error (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

export function initFocusState() {
  return request("/init", { method: "POST" });
}

export function getFocusState() {
  return request("/state");
}

export function completeFocusSession(duration) {
  return request("/complete", {
    method: "POST",
    body: { duration },
  });
}

export function breakFocusSession(progressSec) {
  return request("/break", {
    method: "POST",
    body: { progressSec },
  });
}
