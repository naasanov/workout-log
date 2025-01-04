import axios from "axios";
import { jwtDecode } from "jwt-decode";
const URL = process.env.REACT_APP_API_URL
axios.defaults.withCredentials = true;

const api = axios.create({
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
    console.error(error);
    throw error;
  }
}

api.interceptors.request.use(async (config) => {
  let accessToken = sessionStorage.getItem("accessToken");
  if (isTokenExpired(accessToken)) {
    accessToken = await refreshToken();
  }
  config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
})

export async function login(email, password) {
  const res = await axios.post(`${URL}/auth/login`, {
    email,
    password
  });
  const { accessToken } = res.data.data;
  sessionStorage.setItem("accessToken", accessToken);
}

export async function signup(email, password) {
  const res = await axios.post(`${URL}/auth/signup`, {
    email,
    password
  });
  const { accessToken } = res.data.data;
  sessionStorage.setItem("accessToken", accessToken);
}

export async function logout() {
  try {
    await axios.delete(`${URL}/auth/logout`);
  } catch (error) {
    return console.error(error.response?.data?.message, error)
  }
  sessionStorage.removeItem("accessToken");
}

export default api;