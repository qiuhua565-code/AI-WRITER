/**
 * Typed API client.
 * All paths are relative to /api/v1/ which Next.js rewrites to the backend.
 * Token is read from the auth store (localStorage via Zustand).
 */

import { TaskDetail, TaskListItem, UserMe } from './types'

const BASE = '/api/v1'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.state?.token ?? null
  } catch {
    return null
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401) {
    // Clear stale token and redirect to login
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth-storage')
      window.location.href = '/login'
    }
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body?.detail ?? message
    } catch {}
    throw new Error(message)
  }

  // For 204 or empty body
  const text = await res.text()
  return text ? JSON.parse(text) : (null as unknown as T)
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request<{ access_token: string; token_type: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<UserMe>('/auth/me'),

  updatePassword: (current_password: string, new_password: string) =>
    request<{ message: string }>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password }),
    }),

  updateLLMKey: (api_key: string) =>
    request<{ hint: string }>('/auth/llm-key', {
      method: 'PUT',
      body: JSON.stringify({ api_key }),
    }),

  deleteLLMKey: () =>
    request<{ message: string }>('/auth/llm-key', { method: 'DELETE' }),
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface BatchCreateParams {
  titles: string[]
  config: {
    template: 'emotion_story'
    target_words?: number
    writing_model?: string
    need_plan_review?: boolean
    temperature?: number
  }
}

export interface TaskListResponse {
  items: TaskListItem[]
  total: number
  page: number
  page_size: number
}

export const tasksApi = {
  batchCreate: (params: BatchCreateParams) =>
    request<{ queued_count: number; task_ids: number[] }>('/tasks/batch', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  list: (params?: { status?: string; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.page_size) qs.set('page_size', String(params.page_size))
    return request<TaskListResponse>(`/tasks?${qs}`)
  },

  get: (id: number) => request<TaskDetail>(`/tasks/${id}`),

  control: (id: number, action: 'pause' | 'resume' | 'cancel' | 'approve') =>
    request<{ status: string }>(`/tasks/${id}/control`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),

  exportDocx: (id: number) =>
    fetch(`${BASE}/tasks/${id}/export`, {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
    }),
}
