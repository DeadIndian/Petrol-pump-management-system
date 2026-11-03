export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Share a refresh when several dashboard requests discover an expired session.
let pendingRefresh: Promise<boolean> | null = null;
function refreshBrowserSession() {
  pendingRefresh ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then(response => response.ok).catch(() => false).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

export async function apiRequest<T = unknown>(url: string, options: RequestInit = {}, retried = false): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers } });
  if (response.status === 401 && !retried && !url.startsWith("/api/auth/")) {
    const refreshed = await refreshBrowserSession();
    if (refreshed) return apiRequest<T>(url, options, true);
    if (typeof window !== "undefined") window.location.replace(new URL("/login?expired=1", window.location.origin).href);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed (${response.status})`, response.status);
  }
  return response.json();
}

export const api = {
  get: <T = any>(url: string, options?: RequestInit) => apiRequest<T>(url, options),
  post: <T = any>(url: string, data?: unknown) => apiRequest<T>(url, { method: "POST", body: JSON.stringify(data) }),
  put: <T = any>(url: string, data: unknown) => apiRequest<T>(url, { method: "PUT", body: JSON.stringify(data) }),
  patch: <T = any>(url: string, data: unknown) => apiRequest<T>(url, { method: "PATCH", body: JSON.stringify(data) }),
  delete: <T = any>(url: string) => apiRequest<T>(url, { method: "DELETE" }),
};
