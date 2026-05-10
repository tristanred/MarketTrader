/** POST /auth/register request body. */
export interface RegisterRequest {
  /** 3–30 characters. */
  username: string;
  /** Minimum 8 characters. Hashed with argon2 server-side; never stored in plain text. */
  password: string;
}

/** POST /auth/login request body. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Minimal user representation returned in auth responses and embedded in the JWT payload. */
export interface AuthUser {
  id: string;
  username: string;
}

/**
 * Returned by `POST /auth/register`, `POST /auth/login`, and `POST /auth/refresh`.
 * `token` is a 15-minute access JWT; include it as `Authorization: Bearer <token>`
 * on subsequent requests.
 */
export interface AuthResponse {
  token: string;
  user: AuthUser;
}
