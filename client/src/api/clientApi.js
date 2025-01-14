import axios from "axios";
import { jwtDecode } from "jwt-decode";
const URL = process.env.REACT_APP_API_URL;
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

clientApi.interceptors.response.use(
  response => response,
  error => {
    console.error(error.response?.data?.message, error);
  }
)

export default clientApi;