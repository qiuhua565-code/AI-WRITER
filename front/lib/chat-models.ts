/** 与后端 Anthropic 兼容的 model id；可按中转站实际支持的列表调整 */

export interface ChatModelOption {
  id: string
  label: string
  hint: string
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    hint: '与中转站上登记的 model id 须完全一致；与 Cherry 里选的模型名对齐可减少「能调不能答」',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Sonnet 4.5',
    hint: 'Cherry / aipipe 常见别名；若 4.6 行为异常可改选此项对比',
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    label: 'Sonnet 3.5',
    hint: '旧版官方风格 ID；部分中转映射不同，安全策略可能与 4.x 不一致',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4',
    hint: '更强推理与长程任务',
  },
  {
    id: 'claude-haiku-4-6',
    label: 'Haiku 4',
    hint: '更快、更省',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    label: 'Haiku 3.5',
    hint: '备用轻量模型',
  },
]

export const DEFAULT_CHAT_MODEL_ID =
  CHAT_MODEL_OPTIONS[0]?.id ?? 'claude-sonnet-4-6'

export const CHAT_MODEL_STORAGE_KEY = 'aiwriter-chat-model'
