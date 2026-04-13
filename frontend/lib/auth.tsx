"use client"

/**
 * SECURITY: Auth tokens are stored exclusively in HttpOnly cookies set by the
 * backend. JavaScript (including this file) cannot read or write them.
 * This eliminates the entire class of XSS-based token theft that affected the
 * previous localStorage approach.
 *
 * Session hydration: on mount we call /auth/me — if the access_token cookie is
 * present and valid the backend returns the user profile. If it's expired, the
 * fetch wrapper automatically calls /auth/refresh (which sends the refresh_token
 * cookie). No token values are ever stored in JavaScript variables or storage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { auth as authApi, type AuthTokenResponse, type UserProfile } from "./api"

// ── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
  user: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<AuthTokenResponse>
  logout: () => Promise<void>
  setSession: (data: AuthTokenResponse) => void
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  })

  // Hydrate user from HttpOnly cookie on mount.
  // No localStorage check needed — the cookie is sent automatically by the browser.
  useEffect(() => {
    authApi
      .getMe()
      .then((user) => {
        setState({ user, isLoading: false, isAuthenticated: true })
      })
      .catch((err) => {
        const status = err?.status ?? 0
        if (status === 401 || status === 403) {
          // Cookie missing or genuinely expired after refresh attempt
          setState({ user: null, isLoading: false, isAuthenticated: false })
        } else {
          // Network error (backend down/sleeping) — don't kick user to login
          setState({ user: null, isLoading: false, isAuthenticated: true })
        }
      })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login({ email, password })
    // Backend sets HttpOnly cookies automatically in the login response.
    // We only need the user profile from the response body.
    setState({ user: data.user, isLoading: false, isAuthenticated: true })
    return data
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
      // Backend clears the HttpOnly cookies in the logout response.
    } catch {
      // Ignore — token might already be expired
    }
    setState({ user: null, isLoading: false, isAuthenticated: false })
    router.push("/login")
  }, [router])

  const setSession = useCallback((data: AuthTokenResponse) => {
    // Used after invite-link password set — cookies already set by backend
    setState({ user: data.user, isLoading: false, isAuthenticated: true })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, setSession }),
    [state, login, logout, setSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return ctx
}
