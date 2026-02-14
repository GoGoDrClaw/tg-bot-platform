/**
 * Authentication helper utilities
 */

const TOKEN_KEY = "bot_platform_token";
const USER_KEY = "bot_platform_user";

/**
 * Get JWT token from localStorage
 */
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Save JWT token to localStorage
 */
function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Clear JWT token from localStorage
 */
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Check if user is authenticated (has token)
 */
function isAuthenticated() {
  return getToken() !== null;
}

/**
 * Get current user from localStorage
 */
function getCurrentUser() {
  const userJson = localStorage.getItem(USER_KEY);
  if (!userJson) return null;
  try {
    return JSON.parse(userJson);
  } catch (e) {
    return null;
  }
}

/**
 * Save current user to localStorage
 */
function setCurrentUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Check auth status by calling /me endpoint
 * Returns user object if authenticated, null otherwise
 */
async function checkAuthStatus() {
  const token = getToken();
  if (!token) {
    return null;
  }

  try {
    const response = await fetch("/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      clearToken();
      return null;
    }

    const user = await response.json();
    setCurrentUser(user);
    return user;
  } catch (error) {
    console.error("Auth check failed:", error);
    clearToken();
    return null;
  }
}

/**
 * Logout user
 */
function logout() {
  clearToken();
  window.location.href = "/login.html";
}

/**
 * Get auth headers for API requests
 */
function getAuthHeaders() {
  const token = getToken();
  if (!token) {
    return {};
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Redirect to login if not authenticated
 */
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = "/login.html";
    return false;
  }
  return true;
}
