import axios from "axios";
import type { AxiosError, AxiosInstance } from "axios";

// Same-origin `/api` by default in production; VITE_API_URL overrides for local dev.
const URL: string = import.meta.env.VITE_API_URL || '/api'

// Shape of the `{ message }` error envelope every route handler returns.
type ApiErrorBody = { message?: string };

const authApi: AxiosInstance = axios.create({
  withCredentials: true,
  baseURL: URL
})

authApi.interceptors.response.use(
  response => response,
  (error: AxiosError<ApiErrorBody>) => {
    console.error(error.response?.data?.message);
    return Promise.reject(error);
  }
)

// A signed-in user, as returned by the login/signup endpoints.
export type User = { uuid: string; email: string };

async function login(email: string, password: string): Promise<User> {
  const res = await authApi.post(`/auth/login`, {
    email,
    password
  });
  const { accessToken } = res.data.data;
  sessionStorage.setItem("accessToken", accessToken);
  return res.data.data.user;
}

async function signup(email: string, password: string): Promise<User> {
  const res = await authApi.post(`/auth/signup`, {
    email,
    password
  });
  const { accessToken } = res.data.data;
  sessionStorage.setItem("accessToken", accessToken);
  return res.data.data.user;
}

async function logout(): Promise<void> {
  await authApi.delete(`/auth/logout`);
  sessionStorage.removeItem("accessToken");
}

// #312: only a 200 response is definitive. Axios throws for a 5xx or network
// error, which callers should treat as transient and retry, not "signed out".
async function isLoggedIn(): Promise<boolean> {
  const res = await authApi.get('/auth/logged-in');
  return res.data.data.signedIn;
}

export { login, signup, logout, isLoggedIn };
