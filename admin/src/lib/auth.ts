// Web auth helpers — access token in localStorage + cookie (for Edge middleware)
// Refresh token in localStorage — auto-refreshed silently on 401

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const TOKEN_KEY = "admin_token";
const REFRESH_KEY = "admin_refresh_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setToken(accessToken: string, refreshToken?: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  // Cookie lets Next.js Edge middleware check auth server-side
  document.cookie = `${TOKEN_KEY}=${accessToken}; path=/; SameSite=Strict; max-age=${7 * 24 * 60 * 60}`;
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function logout(): void {
  clearToken();
  window.location.href = "/login";
}

// Silently refresh the access token using the stored refresh token.
// Returns true if successful, false if the session truly expired.
async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { accessToken: string; refreshToken: string };
    setToken(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function fetchWithAuth(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    // Try to silently refresh and retry once
    const refreshed = await tryRefresh();
    if (refreshed) {
      const newToken = getToken();
      if (newToken) headers.set("Authorization", `Bearer ${newToken}`);
      const retried = await fetch(`${API_URL}${path}`, { ...options, headers });
      if (retried.status === 401) {
        clearToken();
        if (typeof window !== "undefined") window.location.href = "/login";
        throw new Error("Session expired");
      }
      return retried;
    }
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Session expired");
  }

  // 403 = wrong role — clear token and redirect to login
  if (res.status === 403) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Access denied");
  }

  return res;
}
