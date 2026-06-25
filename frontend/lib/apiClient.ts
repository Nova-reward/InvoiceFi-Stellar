import { cookies } from 'next/headers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

/**
 * Helper to make authenticated API calls.
 * Automatically handles 401 responses by clearing session and redirecting to connect-wallet.
 */
export async function apiCall<T = any>(
  endpoint: string,
  options: RequestInit = {},
): Promise<{ data?: T; error?: ApiError; status: number }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add authorization header if token exists
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    // Handle 401 Unauthorized - wallet session expired
    if (response.status === 401) {
      const errorData = (await response.json()) as ApiError;

      // Clear session state
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('walletAddress');
        sessionStorage.removeItem('walletRole');
        localStorage.removeItem('lastConnectedWallet');
      }

      // Redirect to connect-wallet (this will be handled client-side)
      return {
        error: errorData,
        status: 401,
      };
    }

    if (!response.ok) {
      const errorData = (await response.json()) as ApiError;
      return {
        error: errorData,
        status: response.status,
      };
    }

    const data = (await response.json()) as T;
    return { data, status: response.status };
  } catch (error) {
    console.error('API call failed:', error);
    return {
      error: {
        statusCode: 500,
        error: 'NETWORK_ERROR',
        message: 'Failed to make API request',
      },
      status: 500,
    };
  }
}

/**
 * Logout endpoint to clear authentication session on the backend.
 */
export async function logout() {
  try {
    await apiCall('/auth/logout', { method: 'POST' });

    // Clear local storage on client
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('walletAddress');
      sessionStorage.removeItem('walletRole');
      localStorage.removeItem('lastConnectedWallet');
    }
  } catch (error) {
    console.error('Logout failed:', error);
  }
}
