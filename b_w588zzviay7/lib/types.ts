// 任务状态
export type TaskStatus = 
  | 'pending'      // 等待执行
  | 'processing'   // 执行中
  | 'completed'    // 已完成（待审核）
  | 'approved'     // 已通过
  | 'rejected'     // 已拒绝

// 用户角色
export type UserRole = 'user' | 'admin'

// 用户类型
export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  role: UserRole
  status: 'active' | 'disabled'
  createdAt: string
  taskCount: number
}

// 写作任务
export interface WritingTask {
  id: string
  userId: string
  title: string
  status: TaskStatus
  progress: number // 0-100
  content?: string // 生成的文章内容
  wordCount?: number // 生成后的实际字数
  aiChatHistory?: AIMessage[] // AI对话历史
  createdAt: string
  updatedAt: string
  completedAt?: string
}

// 批量创建任务参数
export interface BatchCreateTaskParams {
  titles: string[]
}

// AI对话消息
export interface AIMessage {
  id: string
  role: 'system' | 'assistant' | 'user'
  content: string
  timestamp: string
  model?: string
}

// AI模型选项
export interface AIModel {
  id: string
  name: string
  provider: string
  description: string
}

// 可用的AI模型
export const AI_MODELS: AIModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', description: '最强综合能力' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', description: '快速响应' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic', description: '最强推理能力' },
  { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic', description: '平衡性能' },
  { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek', description: '性价比之选' },
]
