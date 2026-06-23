import axios from "axios";
import { jwtDecode } from "jwt-decode";
// In production the client is served same-origin as the API, so default to the
// relative `/api` base; local dev overrides this via VITE_API_URL in .env.local.
const URL = import.meta.env.VITE_API_URL || '/api';
axios.defaults.withCredentials = true;

const clientApi = axios.create({
  withCredentials: true,
  baseURL: URL
})

function isTokenExpired(token) {
  if (!token) return true;
  const { exp } = jwtDecode(token);
  return Date.now() >= exp * 1000;
}

async function refreshToken() {
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
let refreshingPromise = null;

clientApi.interceptors.response.use(
  response => response,
  async (error) => {
    const originalRequest = error.config;

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