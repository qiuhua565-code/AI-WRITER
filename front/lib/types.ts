// Backend real status values
export type TaskStatus =
  | 'queued'
  | 'writing'
  | 'plan_review'
  | 'paused'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'failed'

export type UserRole = 'user' | 'admin'

export interface UserMe {
  id: number
  email: string
  role: UserRole
  status: string
  llm_key_hint?: string | null
  created_at: string
}

export interface SegmentInfo {
  id: number
  index: number
  title: string
  segment_type: 'intro' | 'free' | 'paywall' | 'paid'
  status: string
  word_count: number
  target_word_count: number
  content?: string | null
  summary?: string | null
  retry_count: number
  finish_reason?: string | null
  model_used?: string | null
  created_at: string
  updated_at: string
}

export interface TaskListItem {
  id: number
  title: string
  status: TaskStatus
  progress: number
  word_count?: number | null
  total_tokens_in: number
  total_tokens_out: number
  total_llm_calls: number
  created_at: string
  updated_at: string
  started_at?: string | null
  completed_at?: string | null
  error_msg?: string | null
  warning_msg?: string | null
}

export interface TaskDetail extends TaskListItem {
  config: Record<string, unknown>
  outline?: Record<string, unknown> | null
  content?: string | null
  segments: SegmentInfo[]
}

export interface StoryPlan {
  story_type: string
  title_interpretation: string
  core_conflict: string
  key_characters: Array<{ name: string; role: string; background: string }>
  event_timeline: string
  dramatic_scene: string
  free_part_beats: string[]
  paywall_hook: string
  paid_part_revelation: string
}

// ─── Legacy / Admin types ───────────────────────────────────────────────────

/** Admin user listing type */
export interface User {
  id: string
  name?: string
  email: string
  role: UserRole
  status: 'active' | 'disabled'
  createdAt: string
  taskCount: number
}

/** Legacy WritingTask shape kept for admin pages */
export interface WritingTask {
  id: string
  userId: string
  title: string
  status: string
  progress: number
  content?: string
  wordCount?: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}
