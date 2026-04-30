import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { UserMe } from '../types'

// Cookie helpers (non-httpOnly so middleware can read it for basic route protection)
function setAuthCookie(token: string | null) {
  if (typeof document === 'undefined') return
  if (token) {
    document.cookie = `auth-token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`
  } else {
    document.cookie = 'auth-token=; path=/; max-age=0'
  }
}

interface AuthState {
  token: string | null
  user: UserMe | null
  setAuth: (token: string, user: UserMe) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        setAuthCookie(token)
        set({ token, user })
      },
      clearAuth: () => {
        setAuthCookie(null)
        set({ token: null, user: null })
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        // Re-sync cookie after rehydration from localStorage
        if (state?.token) setAuthCookie(state.token)
      },
    }
  )
)
