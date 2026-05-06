"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { diffWords } from "diff"
import type { Change } from "diff"
import {
  Plus,
  Trash2,
  Send,
  MessageSquare,
  Bot,
  User,
  Copy,
  RefreshCw,
  Check,
  ThumbsUp,
  ThumbsDown,
  Pencil,
  LayoutDashboard,
  Search,
  Menu,
  Home,
  Download,
  Sparkles,
  MoreHorizontal,
  ImagePlus,
  FileType,
  X,
  FileText,
  BookOpen,
  GitCompare,
  ClipboardCheck,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { chatApi, ChatSession, ChatMessage, ChatAttachmentPart, isDocAttachmentMeta, tasksApi } from "@/lib/api"
import { useAuthStore } from "@/lib/store/auth"
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL_ID,
  CHAT_MODEL_STORAGE_KEY,
} from "@/lib/chat-models"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism"

interface DisplayMessage extends ChatMessage {
  streaming?: boolean
}

const MM_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
])

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
  "text/xml",
  "application/xml",
])

const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/** 与后端 `_TEXT_EXT_SUFFIX` 大致对齐，用于扩展名推断 */
const TEXT_EXT_RE =
  /\.(txt|md|markdown|csv|json|html?|xml|log|yaml|yml|py|ts|tsx|js|mjs|cjs|css|sh|bat|ps1|env|ini|cfg|toml|go|rs|java|c|h|cpp|hpp|cs|php|rb|swift|kt|sql|vue|svelte)$/i

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".docx")) return DOCX_MEDIA_TYPE
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".txt")) return "text/plain"
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown"
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html"
  if (lower.endsWith(".xml")) return "text/xml"
  return ""
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = r.result as string
      const i = s.indexOf(",")
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

/** 返回用于上传的 media_type；无法识别则 null（避免把未知二进制当文本发给后端） */
function resolveUploadMediaType(file: File): string | null {
  let mt = (file.type || "").split(";")[0].trim().toLowerCase()
  const nl = file.name.toLowerCase()
  if (!mt || mt === "application/octet-stream") {
    mt = guessMimeFromName(file.name)
  }
  if (MM_UPLOAD_TYPES.has(mt)) return mt
  if (nl.endsWith(".docx") || mt.includes("wordprocessingml")) return DOCX_MEDIA_TYPE
  if (TEXT_MIME_TYPES.has(mt)) return mt
  if (TEXT_EXT_RE.test(file.name)) return mt || "text/plain"
  return null
}

function extBadge(fileName: string, mediaType: string): string {
  const lower = fileName.toLowerCase()
  const mt = (mediaType || "").split(";")[0].trim().toLowerCase()
  if (lower.endsWith(".docx") || mt.includes("wordprocessingml")) return "DOCX"
  if (lower.endsWith(".pdf") || mt === "application/pdf") return "PDF"
  if (lower.endsWith(".png")) return "PNG"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "JPG"
  if (lower.endsWith(".gif")) return "GIF"
  if (lower.endsWith(".webp")) return "WEBP"
  if (TEXT_MIME_TYPES.has(mt) || TEXT_EXT_RE.test(fileName)) {
    const ext = lower.match(/\.([a-z0-9]+)$/i)?.[1]
    return (ext ?? "txt").toUpperCase().slice(0, 8)
  }
  return mt.split("/")[1]?.toUpperCase().slice(0, 6) || "FILE"
}

function isPendingDocLike(a: ChatAttachmentPart): boolean {
  const mt = (a.media_type || "").split(";")[0].trim().toLowerCase()
  const fn = (a.file_name || "").toLowerCase()
  if (mt.includes("wordprocessingml")) return true
  if (TEXT_MIME_TYPES.has(mt)) return true
  if (TEXT_EXT_RE.test(fn)) return true
  return false
}

async function ingestLocalFiles(
  files: File[],
  append: (parts: ChatAttachmentPart[]) => void
): Promise<void> {
  const next: ChatAttachmentPart[] = []
  for (const file of files) {
    const mt = resolveUploadMediaType(file)
    if (!mt) {
      window.alert(
        `${file.name}\n不支持该类型。支持：图片、PDF、Word（.docx）、常见文本与源码；其它请先导出为 PDF 或纯文本。`
      )
      continue
    }
    if (file.size > 6 * 1024 * 1024) {
      window.alert(`文件过大（≤6MB）：${file.name}`)
      continue
    }
    try {
      const data = await readFileAsBase64(file)
      next.push({ media_type: mt, data, file_name: file.name })
    } catch {
      window.alert(`读取失败：${file.name}`)
    }
  }
  if (next.length) append(next)
}

/** 流式中途失败时附带浏览器已收到的正文 */
function streamErrorPartial(e: unknown): string {
  if (e && typeof e === "object" && "partialAssistantText" in e) {
    return String((e as { partialAssistantText?: string }).partialAssistantText ?? "")
  }
  return ""
}

/** 将服务端消息与浏览器已收到的流式正文对齐，避免 refresh 把「已经刷出来的字」吞掉 */
function reconcileChatMessages(
  serverMsgs: ChatMessage[],
  streamedAssistant: string,
  optimisticAssistantId: number,
  streamError: string | null
): DisplayMessage[] {
  const displayBody =
    streamError && streamedAssistant.trim()
      ? `${streamedAssistant.trim()}\n\n—\n（未能完整保存：${streamError}）`
      : streamedAssistant
  const streamText = displayBody.trim()
  const streamLen = streamText.length
  const base = serverMsgs.map((m) => ({ ...m })) as DisplayMessage[]
  let targetIdx = base.findIndex(
    (m) => m.role === "assistant" && m.id === optimisticAssistantId
  )
  if (targetIdx < 0) {
    const assistantIndices = base
      .map((m, i) => (m.role === "assistant" ? i : -1))
      .filter((i) => i >= 0)
    targetIdx =
      assistantIndices.length > 0
        ? assistantIndices[assistantIndices.length - 1]
        : -1
  }
  const targetAsst = targetIdx >= 0 ? base[targetIdx] : undefined
  const serverLen = (targetAsst?.content?.trim().length ?? 0)

  if (streamLen > 0 && (!targetAsst || streamLen > serverLen + 15)) {
    if (targetAsst && targetIdx >= 0) {
      base[targetIdx] = {
        ...targetAsst,
        content: displayBody,
        streaming: false,
      }
    } else {
      base.push({
        id: optimisticAssistantId,
        role: "assistant",
        content: displayBody,
        model: null,
        created_at: new Date().toISOString(),
        streaming: false,
      })
    }
    return base
  }

  if (streamError && streamLen === 0) {
    const last = base[base.length - 1]
    const needsAssistantNote =
      !last || last.role !== "assistant" || !(last.content?.trim())
    if (needsAssistantNote) {
      base.push({
        id: optimisticAssistantId,
        role: "assistant",
        content: `请求失败：${streamError}`,
        model: null,
        created_at: new Date().toISOString(),
        streaming: false,
      })
    }
    return base
  }

  return base
}

async function consumeChatSSE(
  res: Response,
  onAccumulated: (text: string) => void
): Promise<string> {
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "")
    throw new Error(t || `HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let accumulated = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      try {
        const event = JSON.parse(raw) as {
          type?: string
          content?: string
          error?: string
        }
        if (event.type === "error") {
          throw Object.assign(new Error(event.error || "流式输出失败"), {
            partialAssistantText: accumulated,
          })
        }
        if (event.type === "token" && event.content) {
          accumulated += event.content
          onAccumulated(accumulated)
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }
  return accumulated
}

function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1 align-middle">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70"
          style={{ animation: `chatDot 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </span>
  )
}

function MessageContent({
  content,
  streaming,
}: {
  content: string
  streaming?: boolean
}) {
  return (
    <div
      className="prose prose-sm max-w-none break-words select-text text-[15px] leading-relaxed text-slate-800
      prose-p:my-2 prose-headings:font-semibold prose-headings:my-3
      prose-ul:my-2 prose-ol:my-2 prose-li:my-1
      prose-code:text-rose-600 prose-code:bg-slate-100/90 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[13px]
      prose-pre:my-3 prose-pre:p-0 prose-pre:bg-transparent
      [&_blockquote]:border-l-4 [&_blockquote]:border-amber-400/50 [&_blockquote]:bg-amber-50/60 [&_blockquote]:rounded-r-lg [&_blockquote]:pl-4 [&_blockquote]:py-2
      prose-strong:font-semibold prose-table:text-sm"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <>{children}</>
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "")
            const isBlock = !!match
            if (isBlock) {
              return (
                <SyntaxHighlighter
                  style={oneDark as Record<string, React.CSSProperties>}
                  language={match[1]}
                  PreTag="div"
                  className="!rounded-xl !text-[13px] !my-3 !shadow-sm"
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              )
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming &&
        (content ? (
          <StreamingDots />
        ) : (
          <span className="inline-flex items-center gap-1">
            <StreamingDots />
          </span>
        ))}
    </div>
  )
}

function greetingLabel(): string {
  const h = new Date().getHours()
  if (h < 6) return "夜深了"
  if (h < 12) return "早上好"
  if (h < 18) return "下午好"
  return "晚上好"
}

export default function ChatPage() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const router = useRouter()

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionQuery, setSessionQuery] = useState("")
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [selectedModel, setSelectedModel] = useState(DEFAULT_CHAT_MODEL_ID)
  const [feedback, setFeedback] = useState<Record<number, "up" | "down">>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachmentPart[]
  >([])
  const [fileDragOver, setFileDragOver] = useState(false)

  // ── 关联文章 ──────────────────────────────────────────────────────────────
  const [linkedTask, setLinkedTask] = useState<{ id: number; title: string; content: string } | null>(null)
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const [availableTasks, setAvailableTasks] = useState<{ id: number; title: string; status: string }[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)

  // ── Diff 弹窗 ─────────────────────────────────────────────────────────────
  const [diffDialog, setDiffDialog] = useState<{
    oldText: string
    newText: string
    taskId: number
  } | null>(null)
  const [applying, setApplying] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  /** 仅在用户处于消息区底部附近时跟随流式输出滚动 */
  const followStreamOutputRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)

  const displayName = useMemo(() => {
    if (!user?.email) return "用户"
    return user.email.split("@")[0] ?? user.email
  }, [user])

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem(CHAT_MODEL_STORAGE_KEY)
        : null
    if (saved && CHAT_MODEL_OPTIONS.some((m) => m.id === saved)) {
      setSelectedModel(saved)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel)
  }, [selectedModel])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  const isMessagesNearBottom = useCallback((el: HTMLDivElement) => {
    const { scrollTop, scrollHeight, clientHeight } = el
    return scrollHeight - scrollTop - clientHeight < 96
  }, [])

  const onMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current
    if (!el) return
    followStreamOutputRef.current = isMessagesNearBottom(el)
  }, [isMessagesNearBottom])

  useEffect(() => {
    if (!followStreamOutputRef.current) return
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (!activeSession) return
    followStreamOutputRef.current = true
  }, [activeSession?.id])

  useEffect(() => {
    chatApi
      .listSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoadingSessions(false))
  }, [])

  useEffect(() => {
    if (!activeSession) {
      setMessages([])
      return
    }
    if (sendingRef.current) return
    chatApi
      .getMessages(activeSession.id)
      .then(setMessages)
      .catch(console.error)
  }, [activeSession])

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, sessionQuery])

  const streamToSession = useCallback(
    async (
      session: ChatSession,
      content: string,
      modelForStream: string,
      attachments?: ChatAttachmentPart[],
      context?: { type: string; content: string }
    ) => {
      const userMsg: DisplayMessage = {
        id: Date.now(),
        role: "user",
        content,
        model: null,
        created_at: new Date().toISOString(),
        attachments: attachments?.length ? attachments : null,
      }
      const assistantMsg: DisplayMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: "",
        model: null,
        created_at: new Date().toISOString(),
        streaming: true,
      }
      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setSending(true)
      sendingRef.current = true
      followStreamOutputRef.current = true

      let streamedAssistant = ""
      let streamError: string | null = null

      try {
        const res = await chatApi.streamMessage(
          session.id,
          content,
          modelForStream,
          attachments,
          context
        )
        streamedAssistant = await consumeChatSSE(res, (acc) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: acc, streaming: true } : m
            )
          )
        })
      } catch (e: unknown) {
        streamError = e instanceof Error ? e.message : String(e)
        const partial = streamErrorPartial(e)
        if (partial) streamedAssistant = partial
      } finally {
        sendingRef.current = false
        setSending(false)
        chatApi
          .getMessages(session.id)
          .then((serverMsgs) =>
            setMessages(
              reconcileChatMessages(
                serverMsgs,
                streamedAssistant,
                assistantMsg.id,
                streamError
              )
            )
          )
          .catch(() =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, streaming: false } : m
              )
            )
          )
      }
    },
    []
  )

  // ── 关联文章相关 ──────────────────────────────────────────────────────────
  const loadAvailableTasks = useCallback(async () => {
    setLoadingTasks(true)
    try {
      const data = await tasksApi.list({ page_size: 50 })
      setAvailableTasks(
        data.items
          .filter((t) => t.status === "review" || t.status === "approved")
          .map((t) => ({ id: t.id, title: t.title, status: t.status }))
      )
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  const handleLinkTask = useCallback(async (taskId: number, title: string) => {
    try {
      const detail = await tasksApi.get(taskId)
      setLinkedTask({ id: taskId, title, content: detail.content ?? "" })
      setTaskPickerOpen(false)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const handleApplyDiff = useCallback(async (taskId: number, newContent: string) => {
    setApplying(true)
    try {
      const res = await tasksApi.updateContent(taskId, newContent)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // 更新本地关联文章的内容
      setLinkedTask((prev) => prev ? { ...prev, content: newContent } : null)
      setDiffDialog(null)
    } catch (e) {
      console.error(e)
      alert("应用失败，请重试")
    } finally {
      setApplying(false)
    }
  }, [])

  const handleNewSession = async () => {
    try {
      const session = await chatApi.createSession("新对话")
      setSessions((prev) => [session, ...prev])
      setActiveSession(session)
      setMobileNavOpen(false)
    } catch (e) {
      console.error(e)
    }
  }

  const handleDeleteSession = async (
    session: ChatSession,
    e: React.MouseEvent
  ) => {
    e.stopPropagation()
    try {
      await chatApi.deleteSession(session.id)
      setSessions((prev) => prev.filter((s) => s.id !== session.id))
      if (activeSession?.id === session.id) setActiveSession(null)
    } catch (e) {
      console.error(e)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    await ingestLocalFiles(Array.from(files), (parts) =>
      setPendingAttachments((prev) => [...prev, ...parts].slice(0, 8))
    )
    e.target.value = ""
  }

  const handleMainDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "copy"
    if (!fileDragOver) setFileDragOver(true)
  }

  const handleMainDragLeave = (e: React.DragEvent) => {
    const rel = e.relatedTarget as Node | null
    if (rel && e.currentTarget.contains(rel)) return
    setFileDragOver(false)
  }

  const handleMainDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    setFileDragOver(false)
    const { files } = e.dataTransfer
    if (!files?.length) return
    await ingestLocalFiles(Array.from(files), (parts) =>
      setPendingAttachments((prev) => [...prev, ...parts].slice(0, 8))
    )
  }

  const handleSend = async () => {
    const text = input.trim()
    const attachments =
      pendingAttachments.length > 0 ? [...pendingAttachments] : undefined
    if ((!text && !attachments) || sending) return

    setInput("")
    setPendingAttachments([])

    let session = activeSession
    const titleHint = text || "图片或附件"

    if (!session) {
      try {
        sendingRef.current = true
        session = await chatApi.createSession(titleHint.slice(0, 24))
        setSessions((prev) => [session!, ...prev])
        setActiveSession(session)
      } catch (e) {
        sendingRef.current = false
        console.error(e)
        return
      }
    } else if (messages.length === 0) {
      const newTitle = titleHint.slice(0, 24)
      chatApi.updateSession(session.id, newTitle).catch(console.error)
      setSessions((prev) =>
        prev.map((s) => (s.id === session!.id ? { ...s, title: newTitle } : s))
      )
    }

    await streamToSession(session, text, selectedModel, attachments, linkedTask ? { type: 'editor_content', content: linkedTask.content } : undefined)
  }

  const handleRegenerate = async (assistantMsgId: number) => {
    if (sending || !activeSession) return
    const assistantMsg = messages.find((m) => m.id === assistantMsgId)
    const modelToUse = assistantMsg?.model ?? selectedModel

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMsgId ? { ...m, content: "", streaming: true } : m
      )
    )
    setSending(true)
    sendingRef.current = true
    followStreamOutputRef.current = true

    let streamedAssistant = ""
    let streamError: string | null = null

    try {
      const res = await chatApi.regenerateStream(
        activeSession.id,
        assistantMsgId,
        modelToUse
      )
      streamedAssistant = await consumeChatSSE(res, (acc) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: acc, streaming: true } : m
          )
        )
      })
    } catch (e: unknown) {
      streamError = e instanceof Error ? e.message : String(e)
      const partial = streamErrorPartial(e)
      if (partial) streamedAssistant = partial
    } finally {
      sendingRef.current = false
      setSending(false)
      chatApi
        .getMessages(activeSession.id)
        .then((serverMsgs) =>
          setMessages(
            reconcileChatMessages(
              serverMsgs,
              streamedAssistant,
              assistantMsgId,
              streamError
            )
          )
        )
        .catch(console.error)
    }
  }

  const handleDeleteMessage = async (msgId: number) => {
    if (!activeSession) return
    try {
      await chatApi.deleteMessage(activeSession.id, msgId)
      const updated = await chatApi.getMessages(activeSession.id)
      setMessages(updated)
    } catch (e) {
      console.error(e)
    }
  }

  const handleSaveEdit = async (msgId: number) => {
    if (!activeSession) return
    const text = editDraft.trim()
    if (!text) return
    try {
      await chatApi.updateMessage(activeSession.id, msgId, text)
      const updated = await chatApi.getMessages(activeSession.id)
      setMessages(updated)
      setEditingId(null)
      setEditDraft("")
    } catch (e) {
      console.error(e)
    }
  }

  const handleExportMarkdown = () => {
    if (!activeSession || messages.length === 0) return
    const lines = messages.map((m) => {
      const head = m.role === "user" ? "## 你" : "## 助手"
      let body = m.content || ""
      if (m.role === "user" && m.attachments?.length) {
        const summary = m.attachments
          .map((att) => {
            if (isDocAttachmentMeta(att)) {
              return `${att.filename}（${att.lines} 行）`
            }
            return att.media_type === "application/pdf" ? "PDF" : "图片"
          })
          .join("、")
        body =
          (body ? `${body}\n\n` : "") +
          `*[含 ${m.attachments.length} 个附件：${summary}。Markdown 中不含文件正文]*`
      }
      return `${head}\n\n${body}\n`
    })
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${activeSession.title || "chat"}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleLogout = () => {
    clearAuth()
    router.replace("/login")
  }

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "U"

  const SidebarBody = (
    <>
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-white/80"
        >
          <LayoutDashboard className="h-4 w-4" />
          工作台
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleNewSession}
          title="新对话"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            placeholder="搜索会话标题"
            className="h-9 rounded-lg border-slate-200/80 bg-white/90 pl-8 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        {loadingSessions ? (
          <p className="px-3 py-4 text-xs text-slate-500">加载中…</p>
        ) : filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-slate-500">
            <MessageSquare className="h-10 w-10 opacity-35" />
            <p className="text-xs">暂无会话，点右上角 + 新建</p>
          </div>
        ) : (
          <div className="space-y-0.5 pb-3">
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setActiveSession(session)
                  setMobileNavOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setActiveSession(session)
                    setMobileNavOpen(false)
                  }
                }}
                className={cn(
                  "group flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  activeSession?.id === session.id
                    ? "bg-white shadow-sm ring-1 ring-amber-200/80"
                    : "hover:bg-white/70 text-slate-700"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                  onClick={(e) => handleDeleteSession(session, e)}
                  title="删除会话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-slate-200/80 p-3">
        <div className="rounded-xl bg-white/90 p-3 shadow-sm ring-1 ring-slate-200/60">
          <div className="flex items-center gap-2">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-amber-100 text-amber-900 text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {displayName}
              </p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full border-slate-200"
            onClick={handleLogout}
          >
            退出登录
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {/* 桌面侧栏 */}
      <aside className="hidden w-[272px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2 border-b border-slate-200/80 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              AI-StoryFlow
            </p>
            <p className="text-[11px] text-slate-500">对话</p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{SidebarBody}</div>
      </aside>

      {/* 移动端抽屉 */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <div className="flex md:hidden">
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="fixed left-3 top-3 z-40 border-slate-200 bg-white/95 shadow-sm">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-[280px] flex-col bg-sidebar p-0">
            <SheetHeader className="border-b border-slate-200/80 px-4 py-3 text-left">
              <SheetTitle className="text-base">会话列表</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {SidebarBody}
            </div>
          </SheetContent>
        </div>
      </Sheet>

      {/* 主区域：拦截拖放，避免浏览器默认「打开/下载」文件 */}
      <div
        className={cn(
          "relative flex min-w-0 flex-1 flex-col transition-colors",
          fileDragOver && "bg-amber-100/50 ring-2 ring-inset ring-amber-400/60"
        )}
        onDragOver={handleMainDragOver}
        onDragLeave={handleMainDragLeave}
        onDrop={handleMainDrop}
      >
        {/* 顶栏 */}
        <header className="flex h-auto shrink-0 flex-col border-b border-border bg-background/95 backdrop-blur-md">
          <div className="flex h-14 items-center justify-between px-4 pt-10 md:pt-0">
            <div className="min-w-0 flex items-center gap-2 pl-10 md:pl-0">
              <h1 className="truncate text-sm font-semibold text-slate-900 md:text-base">
                {activeSession?.title ?? "新对话"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {linkedTask && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  onClick={async () => {
                    const text = "请帮我全面检查这篇文章"
                    setInput("")
                    let session = activeSession
                    if (!session) {
                      try {
                        sendingRef.current = true
                        session = await chatApi.createSession(text.slice(0, 24))
                        setSessions((prev) => [session!, ...prev])
                        setActiveSession(session)
                      } catch (e) {
                        sendingRef.current = false
                        console.error(e)
                        return
                      }
                    }
                    await streamToSession(
                      session,
                      text,
                      selectedModel,
                      undefined,
                      { type: 'editor_content', content: linkedTask.content }
                    )
                  }}
                  disabled={sending}
                  type="button"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  一键检查
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-1.5 text-xs",
                  linkedTask
                    ? "border-primary/40 bg-primary/5 text-primary"
                    : "border-slate-200 text-slate-600"
                )}
                onClick={() => {
                  loadAvailableTasks()
                  setTaskPickerOpen(true)
                }}
                type="button"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {linkedTask ? linkedTask.title.slice(0, 12) + (linkedTask.title.length > 12 ? "…" : "") : "关联文章"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="hidden text-slate-600 sm:inline-flex"
                type="button"
                onClick={() => activeSession && chatApi.getMessages(activeSession.id).then(setMessages)}
              >
                刷新消息
              </Button>
            </div>
          </div>
          {linkedTask && (
            <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/60 px-4 py-1.5 text-xs text-amber-800">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span>已关联：<span className="font-medium">{linkedTask.title}</span></span>
              <span className="text-amber-600">·</span>
              <span>{linkedTask.content.length > 0 ? `${Math.round(linkedTask.content.replace(/[^\u4e00-\u9fff]/g, '').length)}+ 字` : "空文章"}</span>
              <button
                className="ml-auto text-amber-600 hover:text-amber-900"
                onClick={() => setLinkedTask(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </header>

        {/* 公告条 */}
        <div className="shrink-0 border-b border-amber-200/50 bg-amber-50/90 px-4 py-2 text-center text-[11px] text-amber-950/85 sm:text-xs">
          支持将<span className="font-medium">图片 / PDF / Word（.docx）/ 文本</span>
          拖入此区域或输入框。文档在对话中以卡片展示，不展开全文。模型需支持识图/读文档（如 Sonnet、Opus）。
        </div>

        {/* 消息区 */}
        <div
          ref={messagesScrollRef}
          onScroll={onMessagesScroll}
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-32 pt-4 md:px-10"
        >
          {!activeSession ? (
            <div className="flex min-h-[48vh] flex-col items-center justify-center gap-6 px-2 text-center">
              <p className="font-serif text-3xl font-normal tracking-tight text-slate-800 md:text-4xl">
                <span className="mr-2 inline-block text-amber-500">☀</span>
                {greetingLabel()}，{displayName}
              </p>
              <p className="max-w-md text-sm text-slate-600">
                我可以陪你讨论大纲、润色章节或随手问答。选好模型后，在下方输入即可开始。
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {["续写段落", "梳理人设", "生成标题", "检查错别字"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="rounded-full border border-slate-200/90 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:border-amber-300/80 hover:bg-amber-50/50"
                    onClick={() => setInput((prev) => (prev ? `${prev}\n${t}` : t))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-slate-600">
              <Bot className="h-12 w-12 text-amber-200" />
              <p className="text-sm font-medium text-slate-800">
                新会话「{activeSession.title}」
              </p>
              <p className="max-w-sm text-xs text-slate-500">
                在下方输入第一条消息，或换一个模型后再开始。
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-10 pb-8">
              {messages.map((msg) => (
                <div key={msg.id} className="group/msg">
                  {msg.role === "user" ? (
                    <div className="flex justify-end gap-3">
                      <div className="max-w-[85%] rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/80">
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {msg.attachments.map((a, i) =>
                              isDocAttachmentMeta(a) ? (
                                <div
                                  key={`doc-${i}-${a.filename}`}
                                  className="w-full max-w-[240px] rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100"
                                >
                                  <p
                                    className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-800"
                                    title={a.filename}
                                  >
                                    {a.filename}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {a.lines} 行
                                  </p>
                                  <span className="mt-2 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">
                                    {a.kind === "docx" ? "DOCX" : "TEXT"}
                                  </span>
                                </div>
                              ) : a.media_type === "application/pdf" ? (
                                <div
                                  key={i}
                                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700"
                                >
                                  <FileType className="h-4 w-4 shrink-0 text-red-500" />
                                  PDF 附件
                                </div>
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={i}
                                  src={`data:${a.media_type};base64,${a.data}`}
                                  alt=""
                                  className="max-h-48 max-w-full rounded-lg border border-slate-200 object-contain"
                                />
                              )
                            )}
                          </div>
                        )}
                        {msg.content ? (
                          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800 select-text">
                            {msg.content}
                          </p>
                        ) : null}
                        {!msg.streaming && (
                          <MessageToolbar
                            onCopy={() => {
                              let t = msg.content || ""
                              if (msg.attachments?.length) {
                                const summary = msg.attachments
                                  .map((att) => {
                                    if (isDocAttachmentMeta(att)) {
                                      return `${att.filename}（${att.lines} 行）`
                                    }
                                    return att.media_type === "application/pdf"
                                      ? "PDF"
                                      : "图片"
                                  })
                                  .join("、")
                                t +=
                                  (t ? "\n\n" : "") +
                                  `*[${msg.attachments.length} 个附件：${summary}。界面中可查看文件]*`
                              }
                              void navigator.clipboard.writeText(t)
                            }}
                            onDelete={() => handleDeleteMessage(msg.id)}
                          />
                        )}
                      </div>
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200/80">
                        <User className="h-4 w-4 text-slate-600" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
                        <Bot className="h-4 w-4 text-amber-800" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {editingId === msg.id ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                            <Textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              className="min-h-[140px] resize-y border-0 p-0 text-sm shadow-none focus-visible:ring-0"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingId(null)
                                  setEditDraft("")
                                }}
                              >
                                取消
                              </Button>
                              <Button size="sm" onClick={() => handleSaveEdit(msg.id)}>
                                保存修改
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <MessageContent
                              content={msg.content}
                              streaming={msg.streaming}
                            />
                            {!msg.streaming && (
                              <AssistantToolbar
                                feedback={feedback[msg.id]}
                                onFeedback={(dir) =>
                                  setFeedback((prev) => ({
                                    ...prev,
                                    [msg.id]: dir,
                                  }))
                                }
                                onCopy={() =>
                                  navigator.clipboard.writeText(msg.content)
                                }
                                onRegenerate={() => handleRegenerate(msg.id)}
                                onEdit={() => {
                                  setEditingId(msg.id)
                                  setEditDraft(msg.content)
                                }}
                                onDelete={() => handleDeleteMessage(msg.id)}
                                onDiff={
                                  linkedTask && msg.content.length > 200
                                    ? () =>
                                        setDiffDialog({
                                          oldText: linkedTask.content,
                                          newText: msg.content,
                                          taskId: linkedTask.id,
                                        })
                                    : undefined
                                }
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 底部输入 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/95 to-transparent pb-4 pt-10">
          <div className="pointer-events-auto mx-auto max-w-3xl px-4">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-2 shadow-lg shadow-slate-900/5">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json,.docx,.txt,.md,.json,.csv,.html,.htm,.xml,.py,.ts,.tsx,.js,.css"
                multiple
                onChange={handleFileChange}
              />
              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
                  {pendingAttachments.map((a, i) => {
                    const name =
                      a.file_name ||
                      (a.media_type === "application/pdf"
                        ? "文档.pdf"
                        : "image")
                    const badge = extBadge(name, a.media_type)
                    const docLike = isPendingDocLike(a)
                    const sizeKb = Math.max(
                      1,
                      Math.round(((a.data.length * 3) / 4 / 1024) * 10) / 10
                    )
                    return (
                      <div
                        key={`${i}-${name}-${a.media_type}`}
                        className="group relative w-[142px] overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm"
                      >
                        <div className="flex h-[72px] items-center justify-center bg-slate-50/50">
                          {a.media_type === "application/pdf" ? (
                            <FileType className="h-9 w-9 text-red-500" />
                          ) : docLike ? (
                            <FileText className="h-9 w-9 text-slate-500" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`data:${a.media_type};base64,${a.data}`}
                              alt=""
                              className="max-h-full max-w-full object-contain"
                            />
                          )}
                        </div>
                        <div className="space-y-0.5 border-t border-slate-200/80 p-2">
                          <p
                            className="line-clamp-2 text-[11px] font-medium leading-tight text-slate-800"
                            title={name}
                          >
                            {name}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            约 {sizeKb} KB
                          </p>
                          <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">
                            {badge}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/80 text-white opacity-0 shadow transition group-hover:opacity-100"
                          onClick={() =>
                            setPendingAttachments((p) =>
                              p.filter((_, j) => j !== i)
                            )
                          }
                          aria-label="移除"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div
                className="flex items-end gap-1 sm:gap-2"
                onDragOver={(e) => {
                  if (!e.dataTransfer?.types?.includes("Files")) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = "copy"
                }}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 rounded-xl text-slate-600"
                      type="button"
                      disabled={sending}
                    >
                      <Plus className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault()
                        setTimeout(() => fileInputRef.current?.click(), 0)
                      }}
                    >
                      <ImagePlus className="mr-2 h-4 w-4" />
                      上传图片或 PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled className="text-muted-foreground">
                      截图（浏览器权限，后续可做）
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入文字，或通过左侧 + 添加图片 / PDF / Word / 文本…"
                  className="max-h-52 min-h-[52px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-[15px] shadow-none focus-visible:ring-0"
                  rows={1}
                  disabled={sending}
                />

                <div className="flex shrink-0 flex-col items-end gap-1 pb-1">
                  <Select
                    value={selectedModel}
                    onValueChange={setSelectedModel}
                    disabled={sending}
                  >
                    <SelectTrigger className="h-9 max-w-[140px] rounded-full border-slate-200 text-xs sm:max-w-[180px]">
                      <SelectValue placeholder="模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {CHAT_MODEL_OPTIONS.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-xs">
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 pr-1">
                    <span className="hidden text-[10px] text-slate-500 sm:inline">
                      扩展推理
                    </span>
                    <Switch disabled className="scale-75" aria-readonly />
                  </div>
                </div>

                <Button
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-xl"
                  onClick={handleSend}
                  disabled={
                    (!input.trim() && pendingAttachments.length === 0) ||
                    sending
                  }
                  type="button"
                  title="发送"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              AI 生成内容可能存在失误，请核对关键信息与引用。
            </p>
          </div>
        </div>

        {/* 右侧悬浮工具 */}
        <div className="pointer-events-none absolute right-2 top-20 z-30 hidden flex-col gap-1 md:flex">
          <div className="pointer-events-auto flex flex-col gap-1 rounded-xl border border-slate-200/90 bg-white/95 p-1 shadow-md backdrop-blur-sm">
            <Link href="/dashboard">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg text-slate-600"
                title="工作台首页"
              >
                <Home className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg text-slate-600"
              title="刷新对话"
              type="button"
              onClick={() =>
                activeSession &&
                chatApi.getMessages(activeSession.id).then(setMessages)
              }
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg text-slate-600"
              title="导出 Markdown"
              type="button"
              onClick={handleExportMarkdown}
              disabled={!activeSession || messages.length === 0}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 关联文章选择弹窗 */}
        <Dialog open={taskPickerOpen} onOpenChange={setTaskPickerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                选择关联文章
              </DialogTitle>
            </DialogHeader>
            <div className="py-2">
              {loadingTasks ? (
                <div className="flex items-center justify-center py-8 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  加载中…
                </div>
              ) : availableTasks.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  暂无可关联的文章（需要状态为"待审核"或"已通过"）
                </div>
              ) : (
                <ScrollArea className="max-h-72">
                  <div className="space-y-1 pr-2">
                    {availableTasks.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={cn(
                          "w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-100",
                          linkedTask?.id === t.id && "bg-primary/10 text-primary"
                        )}
                        onClick={() => handleLinkTask(t.id, t.title)}
                      >
                        <div className="font-medium">{t.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {t.status === "review" ? "待审核" : "已通过"}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
            {linkedTask && (
              <div className="border-t pt-3">
                <button
                  type="button"
                  className="text-xs text-destructive hover:underline"
                  onClick={() => { setLinkedTask(null); setTaskPickerOpen(false) }}
                >
                  取消关联
                </button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Diff 对比弹窗 */}
        {diffDialog && (
          <DiffDialog
            oldText={diffDialog.oldText}
            newText={diffDialog.newText}
            taskId={diffDialog.taskId}
            applying={applying}
            onClose={() => setDiffDialog(null)}
            onApply={() => handleApplyDiff(diffDialog.taskId, diffDialog.newText)}
          />
        )}
      </div>
    </div>
  )
}

function MessageToolbar({
  onCopy,
  onDelete,
}: {
  onCopy: () => void
  onDelete: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover/msg:opacity-100">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-slate-500"
        type="button"
        title="复制"
        onClick={async () => {
          await onCopy()
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-slate-500 hover:text-destructive"
        type="button"
        title="删除"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function AssistantToolbar({
  feedback,
  onFeedback,
  onCopy,
  onRegenerate,
  onEdit,
  onDelete,
  onDiff,
}: {
  feedback?: "up" | "down"
  onFeedback: (dir: "up" | "down") => void
  onCopy: () => void
  onRegenerate: () => void
  onEdit: () => void
  onDelete: () => void
  onDiff?: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-200/70 pt-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-slate-500"
        type="button"
        title="复制"
        onClick={async () => {
          await onCopy()
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8",
          feedback === "up" ? "text-amber-700" : "text-slate-500"
        )}
        type="button"
        title="有帮助"
        onClick={() => onFeedback("up")}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8",
          feedback === "down" ? "text-rose-700" : "text-slate-500"
        )}
        type="button"
        title="需改进"
        onClick={() => onFeedback("down")}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-slate-500"
        type="button"
        title="重新生成"
        onClick={onRegenerate}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-slate-500"
        type="button"
        title="编辑正文"
        onClick={onEdit}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      {onDiff && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs text-primary hover:bg-primary/10"
          type="button"
          title="与原文对比，并一键应用"
          onClick={onDiff}
        >
          <GitCompare className="h-3.5 w-3.5" />
          对比原文
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-500"
            type="button"
            title="更多"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            删除此条回复
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DiffDialog({
  oldText,
  newText,
  applying,
  onClose,
  onApply,
}: {
  oldText: string
  newText: string
  taskId: number
  applying: boolean
  onClose: () => void
  onApply: () => void
}) {
  const diffs = diffWords(oldText, newText)
  const oldWordCount = oldText.replace(/[^\u4e00-\u9fff]/g, "").length
  const newWordCount = newText.replace(/[^\u4e00-\u9fff]/g, "").length

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="shrink-0 px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            对比原文
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-1">
            字数：{oldWordCount.toLocaleString()} → {newWordCount.toLocaleString()} 字
            {newWordCount > oldWordCount
              ? <span className="ml-1 text-emerald-600">（+{(newWordCount - oldWordCount).toLocaleString()}）</span>
              : newWordCount < oldWordCount
              ? <span className="ml-1 text-rose-600">（-{(oldWordCount - newWordCount).toLocaleString()}）</span>
              : null
            }
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="font-serif text-[15px] leading-8 text-slate-800 whitespace-pre-wrap break-words">
            {diffs.map((part: Change, i: number) => {
              if (part.removed) {
                return (
                  <span
                    key={i}
                    className="bg-rose-100 text-rose-700 line-through decoration-rose-400"
                  >
                    {part.value}
                  </span>
                )
              }
              if (part.added) {
                return (
                  <span
                    key={i}
                    className="bg-emerald-100 text-emerald-800"
                  >
                    {part.value}
                  </span>
                )
              }
              return <span key={i}>{part.value}</span>
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 px-6 py-4 border-t bg-slate-50/80">
          <div className="flex w-full items-center justify-between">
            <p className="text-xs text-slate-500">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300 mr-1" />
              新增
              <span className="inline-block w-3 h-3 rounded-sm bg-rose-100 border border-rose-300 ml-3 mr-1" />
              删除
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={applying}>
                取消
              </Button>
              <Button onClick={onApply} disabled={applying} className="gap-1.5">
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                应用到文章
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
