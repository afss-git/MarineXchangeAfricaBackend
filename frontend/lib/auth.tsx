"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { auth as authApi, type AuthTokenResponse, type UserProfile, ApiRequestError } from "./api"

// ── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
  user: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<AuthTokenResponse>
  logout: () => Promise<void>
  setSession: (tokens: AuthTokenResponse) => void
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Token helpers ────────────────────────────────────────────────────────────

function saveTokens(data: AuthTokenResponse) {
  localStorage.setItem("access_token", data.access_token)
  localStorage.setItem("refresh_token", data.refresh_token)
  localStorage.setItem("token_expires_at", String(Date.now() + data.expires_in * 1000))
}

function clearTokens() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("refresh_token")
  localStorage.removeItem("token_expires_at")
}

function hasStoredToken(): boolean {
  if (typeof window === "undefined") return false
  return !!localStorage.getItem("access_token")
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  })

  // Hydrate user from stored token on mount
  useEffect(() => {
    if (!hasStoredToken()) {
      setState({ user: null, isLoading: false, isAuthenticated: false })
      return
    }

    authApi
      .getMe()
      .then((user) => {
        setState({ user, isLoading: false, isAuthenticated: true })
      })
      .catch(() => {
        clearTokens()
        setState({ user: null, isLoading: false, isAuthenticated: false })
      })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login({ email, password })
    saveTokens(data)
    setState({ user: data.user, isLoading: false, isAuthenticated: true })
    return data
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Ignore — token might already be expired
    }
    clearTokens()
    setState({ user: null, isLoading: false, isAuthenticated: false })
    router.push("/login")
  }, [router])

  const setSession = useCallback((tokens: AuthTokenResponse) => {
    saveTokens(tokens)
    setState({ user: tokens.user, isLoading: false, isAuthenticated: true })
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
