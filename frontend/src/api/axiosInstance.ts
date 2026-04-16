import axios from 'axios';

const api = axios.create({
  // Using relative path for NGINX proxy compatibility
  baseURL: '/api', 
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

// Response interceptor for global error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Global API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
