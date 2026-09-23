import axios from "axios";
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { jwtDecode } from "jwt-decode";

// In production the client is served same-origin as the API, so default to the
// relative `/api` base; local dev overrides this via VITE_API_URL in .env.local.
const URL: string = import.meta.env.VITE_API_URL || '/api';
axios.defaults.withCredentials = true;

// Shape of the `{ message }` error envelope every route handler returns.
type ApiErrorBody = { message?: string };

// A request config that has already gone through one refresh-and-retry cycle,
// so the 401 handler below doesn't loop forever on a request that still fails.
type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const clientApi: AxiosInstance = axios.create({
  withCredentials: true,
  baseURL: URL
})

function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const { exp } = jwtDecode(token);
  return Date.now() >= exp! * 1000;
}

async function refreshToken(): Promise<string> {
  try {
    const res = await axios.post(`${URL}/auth/token`);
    const token = res.data.data.accessToken;
    sessionStorage.setItem("accessToken", token);
    return token;
  } catch (error) {
    throw error;
  }
}

clientApi.interceptors.request.use(
  async (config) => {
    let accessToken = sessionStorage.getItem("accessToken");
    if (isTokenExpired(accessToken)) {
      accessToken = await refreshToken();
    }
    config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
  }
)

// Track whether a token-refresh is already in flight so concurrent 401s
// don't each trigger a separate refresh call.
let refreshingPromise: Promise<string> | null = null;

clientApi.interceptors.response.use(
  response => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const originalRequest: RetryableConfig = error.config!;

    // Only attempt refresh on a 401 that hasn't already been retried.
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Deduplicate concurrent refresh calls.
        if (!refreshingPromise) {
          refreshingPromise = refreshToken().finally(() => {
            refreshingPromise = null;
          });
        }
        const newToken = await refreshingPromise;
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return clientApi(originalRequest);
      } catch (refreshError) {
        // Refresh failed (e.g. refresh token expired) — propagate the original error.
        console.error(error.response?.data?.message, error);
        return Promise.reject(error);
      }
    }

    // All other errors: log and reject so callers receive a thrown error.
    console.error(error.response?.data?.message, error);
    return Promise.reject(error);
  }
)

export default clientApi;
