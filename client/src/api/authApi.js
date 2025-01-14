import axios from "axios";
const URL = process.env.REACT_APP_API_URL

const authApi = axios.create({
  withCredentials: true,
  baseURL: URL
})

authApi.interceptors.response.use(
  response => response,
  error => {
    console.error(error.response?.data?.message);
    return Promise.reject(error);
  }
)

async function login(email, password) {
  const res = await authApi.post(`/auth/login`, {
    email,
    password
  });
  const { accessToken } = res.data.data;
  sessionStorage.setItem("accessToken", accessToken);
  return res.data.data.user;
}

async function signup(email, password) {
  const res = await authApi.post(`/auth/signup`, {
    email,
    password
  });
  const { accessToken } = res.data.data;
  sessionStorage.setItem("accessToken", accessToken);
  return res.data.data.user;
}

async function logout() {
  await authApi.delete(`/auth/logout`);
  sessionStorage.removeItem("accessToken");
}

async function isLoggedIn() {
  const res = await authApi.get('/auth/logged-in');
  return res.data.data.signedIn;
}

export { login, signup, logout, isLoggedIn };