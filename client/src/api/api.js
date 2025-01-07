import axios from "axios";
import { jwtDecode } from "jwt-decode";
import { useUser } from "../context/UserProvider.jsx";
const URL = process.env.REACT_APP_API_URL

axios.defaults.withCredentials = true;

const api = axios.create({
  withCredentials: true,
  baseURL: URL
})

export default function useApi() {
  const { user, setUser } = useUser()

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

  api.interceptors.request.use(
    async (config) => {
      if (!user) {
        console.log("cancelling b/c user is: ", user)
        const source = axios.CancelToken.source();
        config.cancelToken = source.token;
        source.cancel("Request cancelled. User not signed in");
        return config;
      }
      let accessToken = sessionStorage.getItem("accessToken");
      if (isTokenExpired(accessToken)) {
        accessToken = await refreshToken();
      }
      config.headers.Authorization = `Bearer ${accessToken}`;
      return config;
    }
  )

  api.interceptors.response.use(
    response => response,
    (error) => axios.isCancel(error) ? null : Promise.reject(error)
  )

  async function login(email, password) {
    const res = await axios.post(`${URL}/auth/login`, {
      email,
      password
    });
    const { accessToken } = res.data.data;
    sessionStorage.setItem("accessToken", accessToken);
  }
  
  async function signup(email, password) {
    const res = await axios.post(`${URL}/auth/signup`, {
      email,
      password
    });
    const { accessToken } = res.data.data;
    sessionStorage.setItem("accessToken", accessToken);
    setUser(res.data.data.user);
  }
  
   async function logout() {
    try {
      await axios.delete(`${URL}/auth/logout`);
    } catch (error) {
      return console.error(error.response?.data?.message, error)
    }
    sessionStorage.removeItem("accessToken");
  }

  return { api, login, signup, logout }
}