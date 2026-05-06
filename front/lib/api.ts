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
    'ngrok-skip-browser-warning': 'true',
    ...(options.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401) {
    // Only clear auth and redirect when we're not already on the login page
    // (avoids swallowing wrong-password errors on the login form)
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      localStorage.removeItem('auth-storage')
      window.location.href = '/login'
      throw new Error('Unauthorized')
    }
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
    request<{ access_token: string; token_type: string; user: UserMe }>('/auth/login', {
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
    /** 未传时后端默认 18000；传则须 ≥10000 */
    target_words?: number
    writing_model?: string
    need_plan_review?: boolean
    temperature?: number
    /** 从文件导入的长模板（基础指令） */
    instruction_doc_text?: string
    instruction_doc_filename?: string
    /** 用户手写的短补充提示 */
    batch_prompt?: string
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

  control: (id: number, action: 'pause' | 'resume' | 'cancel' | 'approve' | 'retry') =>
    request<{ status: string }>(`/tasks/${id}/control`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),

  delete: (id: number) =>
    request<{ message: string }>(`/tasks/${id}`, { method: 'DELETE' }),

  exportDocx: (id: number) =>
    fetch(`${BASE}/tasks/${id}/export`, {
      headers: {
        Authorization: `Bearer ${getToken() ?? ''}`,
        'ngrok-skip-browser-warning': 'true',
      },
    }),

  updateContent: (id: number, content: string) =>
    fetch(`${BASE}/tasks/${id}/content`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken() ?? ''}`,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ content }),
    }),
}

// ─── API Keys (multi-provider) ───────────────────────────────────────────────

export interface ApiKey {
  id: number
  provider: string
  purpose: string
  label: string
  key_hint: string
  created_at: string
}

export const apiKeysApi = {
  list: () => request<ApiKey[]>('/auth/api-keys'),

  /** 新增一条 Key（同一用户可多条的 Key 池）；兼容旧名 upsert */
  add: (provider: string, api_key: string, purpose = 'both', label?: string) =>
    request<ApiKey>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify({ provider, purpose, api_key, label: label ?? '' }),
    }),

  upsert: (provider: string, api_key: string, purpose = 'both', label?: string) =>
    request<ApiKey>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify({ provider, purpose, api_key, label: label ?? '' }),
    }),

  delete: (id: number) =>
    request<{ message: string }>(`/auth/api-keys/${id}`, { method: 'DELETE' }),
}

// ─── System Key Pool (admin) ─────────────────────────────────────────────────

export interface SystemKey {
  id: number
  provider: string
  label: string
  purpose: string
  key_hint: string
  is_active: boolean
  in_use: boolean
  created_at: string
}

export const systemKeysApi = {
  list: () => request<SystemKey[]>('/admin/api-keys'),

  add: (provider: string, api_key: string, purpose = 'both', label?: string) =>
    request<SystemKey>('/admin/api-keys', {
      method: 'POST',
      body: JSON.stringify({ provider, purpose, api_key, label: label ?? '' }),
    }),

  delete: (id: number) =>
    request<void>(`/admin/api-keys/${id}`, { method: 'DELETE' }),

  toggle: (id: number) =>
    request<{ id: number; is_active: boolean }>(`/admin/api-keys/${id}/toggle`, { method: 'PATCH' }),

  release: (id: number) =>
    request<{ message: string }>(`/admin/api-keys/${id}/release`, { method: 'POST' }),
}

export interface AdminUser {
  id: number
  email: string
  name: string
  role: string
  status: string
  llm_api_key_hint: string | null
  /** 用户个人 Key 池条数（user_api_keys） */
  api_keys_count?: number
  daily_task_limit: number | null
  created_at: string
}

export interface InitialApiKeyPayload {
  provider: string
  purpose?: string
  api_key: string
  label?: string
}

export interface AdminUserListResponse {
  items: AdminUser[]
  total: number
}

export interface AdminDashboardStats {
  users_total: number
  users_active: number
  tasks_total: number
  tasks_by_status: Record<string, number>
  tasks_running: number
  recent_tasks: Array<{
    id: number
    title: string
    user_id: number
    user_email: string
    status: string
    progress: number
    word_count: number | null
    updated_at: string
  }>
}

export const adminApi = {
  getStats: () => request<AdminDashboardStats>('/admin/stats'),

  listUsers: (page = 1) =>
    request<AdminUserListResponse>(`/admin/users?page=${page}&page_size=50`),

  createUser: (data: {
    email: string
    password: string
    name: string
    role?: string
    initial_api_keys?: InitialApiKeyPayload[]
  }) =>
    request<AdminUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (id: number, data: { status?: string; password?: string; daily_task_limit?: number; role?: string }) =>
    request<AdminUser>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteUser: (id: number) =>
    request<{ message: string }>(`/admin/users/${id}`, { method: 'DELETE' }),
}

/** 管理员管理「指定用户」的个人 Key 池（与全站系统 Key 池无关） */
export const adminUserKeysApi = {
  list: (userId: number) => request<ApiKey[]>(`/admin/users/${userId}/api-keys`),

  add: (userId: number, body: InitialApiKeyPayload) =>
    request<ApiKey>(`/admin/users/${userId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({
        provider: body.provider,
        purpose: body.purpose ?? 'both',
        api_key: body.api_key,
        label: body.label ?? '',
      }),
    }),

  delete: (userId: number, keyId: number) =>
    request<{ message: string }>(`/admin/users/${userId}/api-keys/${keyId}`, {
      method: 'DELETE',
    }),
}

// ─── Chat (general Q&A) ──────────────────────────────────────────────────────

export interface ChatSession {
  id: number
  title: string
  created_at: string
  updated_at: string
}

export type ChatBinaryAttachmentPart = {
  media_type: string
  data: string
  /** 原始文件名，后端用于识别 .docx / 文本等 */
  file_name?: string
}

/** 本地待发附件（含 base64） */
export type ChatAttachmentPart = ChatBinaryAttachmentPart

/** 已发送消息里由后端返回的文档类附件（无正文，不展开） */
export type ChatDocAttachmentMeta = {
  kind: 'docx' | 'text'
  filename: string
  lines: number
}

export type ChatMessageAttachment = ChatBinaryAttachmentPart | ChatDocAttachmentMeta

export function isDocAttachmentMeta(
  a: ChatMessageAttachment
): a is ChatDocAttachmentMeta {
  return 'kind' in a && !('data' in a)
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  model: string | null
  created_at: string
  /** 用户消息：多模态含 data；Word/文本 为 { kind, filename, lines } */
  attachments?: ChatMessageAttachment[] | null
}

export const chatApi = {
  listSessions: () => request<ChatSession[]>('/chat/sessions'),

  createSession: (title = '新对话') =>
    request<ChatSession>('/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  updateSession: (id: number, title: string) =>
    request<{ id: number; title: string }>(`/chat/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  deleteSession: (id: number) =>
    request<{ message: string }>(`/chat/sessions/${id}`, { method: 'DELETE' }),

  getMessages: (sessionId: number) =>
    request<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`),

  deleteMessage: (sessionId: number, messageId: number) =>
    request<{ message: string }>(`/chat/sessions/${sessionId}/messages/${messageId}`, { method: 'DELETE' }),

  updateMessage: (sessionId: number, messageId: number, content: string) =>
    request<ChatMessage>(`/chat/sessions/${sessionId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),

  /** Returns raw Response so caller can read the SSE stream manually. */
  regenerateStream: (sessionId: number, assistantMessageId: number, model?: string) =>
    fetch(`${BASE}/chat/sessions/${sessionId}/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken() ?? ''}`,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        assistant_message_id: assistantMessageId,
        model: model ?? null,
      }),
    }),
  streamMessage: (
    sessionId: number,
    content: string,
    model?: string,
    attachments?: ChatAttachmentPart[],
    context?: { type: string; content: string }
  ) =>
    fetch(`${BASE}/chat/sessions/${sessionId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken() ?? ''}`,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        content,
        model,
        attachments: attachments?.length
          ? attachments.map(({ media_type, data, file_name }) => {
              const fn = file_name?.trim()
              return {
                media_type,
                data,
                ...(fn ? { filename: fn } : {}),
              }
            })
          : undefined,
        context: context ?? undefined,
      }),
    }),
}
