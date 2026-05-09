"use client"

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  createContext,
  useContext,
  type ReactNode,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type AnchorHTMLAttributes,
} from "react"
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
  Eraser,
  Square,
  AlertCircle,
} from "lucide-react"
import { BrandMark } from "@/components/brand-logo"
import { BRAND_NAME } from "@/lib/brand"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import {
  chatApi,
  ChatSession,
  ChatMessage,
  ChatAttachmentPart,
  ChatMessageAttachment,
  isDocAttachmentMeta,
  tasksApi,
} from "@/lib/api"
import { useAuthStore } from "@/lib/store/auth"
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL_ID,
  CHAT_MODEL_STORAGE_KEY,
} from "@/lib/chat-models"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
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

/** 与后端 `_attachment_kind` 对齐，用于乐观渲染时把待发附件转成 API 同形展示结构 */
function localAttachmentKind(a: ChatAttachmentPart): "mm" | "docx" | "text" {
  const mt = (a.media_type || "").split(";")[0].trim().toLowerCase()
  const fn = (a.file_name || "").toLowerCase()
  if (MM_UPLOAD_TYPES.has(mt)) return "mm"
  if (mt === DOCX_MEDIA_TYPE || fn.endsWith(".docx")) return "docx"
  if (TEXT_MIME_TYPES.has(mt)) return "text"
  if (TEXT_EXT_RE.test(fn)) return "text"
  return "mm"
}

function optimisticMessageAttachments(parts: ChatAttachmentPart[]): ChatMessageAttachment[] {
  return parts.map((a) => {
    const kind = localAttachmentKind(a)
    if (kind === "mm") {
      return { media_type: a.media_type, data: a.data, file_name: a.file_name }
    }
    const filename = a.file_name || "附件"
    if (kind === "docx") {
      return { kind: "docx", filename, lines: 1 }
    }
    let lines = 1
    try {
      const bin = atob(a.data)
      const text = new TextDecoder("utf-8", { fatal: false }).decode(
        Uint8Array.from(bin, (c) => c.charCodeAt(0))
      )
      const n = text.split(/\r?\n/).length
      lines = Math.max(1, n)
    } catch {
      lines = 1
    }
    return { kind: "text", filename, lines }
  })
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
  streamError: string | null,
  aborted: boolean = false
): DisplayMessage[] {
  // displayBody 是最终给用户看的文本，包含中断/错误尾标签。
  let displayBody = streamedAssistant
  if (aborted) {
    displayBody = streamedAssistant.trim()
      ? `${streamedAssistant.trim()}\n\n—\n（已停止生成）`
      : "（已停止生成）"
  } else if (streamError && streamedAssistant.trim()) {
    displayBody = `${streamedAssistant.trim()}\n\n—\n（未能完整保存：${streamError}）`
  }
  const streamLen = displayBody.trim().length
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
  const serverLen = targetAsst?.content?.trim().length ?? 0

  // 中断或错误场景：后端持久化是 fire-and-forget，可能此刻 server 还没有这条助手消息，
  // 或保存的版本不带「（已停止生成）」尾标签。这两种场景都必须用前端 displayBody 兜底，
  // 否则用户看到的就是空白 / 半截 —— 这是用户反馈的核心问题。
  const forcePreferStream = aborted || !!streamError

  if (streamLen > 0 && (!targetAsst || forcePreferStream || streamLen > serverLen + 15)) {
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

  if ((streamError || aborted) && streamLen === 0) {
    const last = base[base.length - 1]
    const needsAssistantNote =
      !last || last.role !== "assistant" || !(last.content?.trim())
    if (needsAssistantNote) {
      base.push({
        id: optimisticAssistantId,
        role: "assistant",
        content: aborted ? "（已停止生成）" : `请求失败：${streamError}`,
        model: null,
        created_at: new Date().toISOString(),
        streaming: false,
      })
    }
    return base
  }

  return base
}

/** 用户主动中断流式对话时抛出，可被外层识别为「正常停止」而非真错误。 */
class StreamAbortedByUser extends Error {
  partialAssistantText: string
  constructor(partial: string) {
    super("已停止生成")
    this.name = "StreamAbortedByUser"
    this.partialAssistantText = partial
  }
}

async function consumeChatSSE(
  res: Response,
  onAccumulated: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "")
    throw Object.assign(new Error(t || `HTTP ${res.status}`), {
      partialAssistantText: "",
    })
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let accumulated = ""
  // 监听 AbortSignal，被取消时主动 cancel reader，让 fetch 立刻抛 AbortError
  const onAbort = () => {
    reader.cancel().catch(() => {})
  }
  if (signal) {
    if (signal.aborted) {
      reader.cancel().catch(() => {})
      throw new StreamAbortedByUser(accumulated)
    }
    signal.addEventListener("abort", onAbort, { once: true })
  }
  try {
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
  } catch (e: unknown) {
    if (signal?.aborted) {
      throw new StreamAbortedByUser(accumulated)
    }
    if (e && typeof e === "object" && "partialAssistantText" in e) {
      throw e
    }
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
      partialAssistantText: accumulated,
    })
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort)
    }
  }
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

/** 去掉模型偶发输出的 document 包裹标签（不参与正文） */
function stripDocumentWrapperTags(s: string): string {
  return s.replace(/<\s*\/?\s*document\s*>/gi, "")
}

/** 去掉 <thinking>…</thinking> 等（含大小写），避免整段英文思考污染正文 */
function stripThinkingBlocks(s: string): string {
  return s
    .replace(/<\s*thinking[\s\S]*?<\/\s*thinking\s*>/gi, "")
    .replace(/<\s*thought[\s\S]*?<\/\s*thought\s*>/gi, "")
    .replace(/<\s*redacted_thinking[\s\S]*?<\/\s*redacted_thinking\s*>/gi, "")
    .replace(/<\s*think\s*>[\s\S]*?<\/\s*think\s*>/gi, "")
}

/** 展示用：去掉 document、thinking，并去掉流式末尾未闭合的 <thinking 片段 */
function sanitizeAssistantDisplay(raw: string, streaming?: boolean): string {
  let t = stripDocumentWrapperTags(raw)
  t = stripThinkingBlocks(t)
  if (streaming) {
    const idx = t.search(/<\s*thinking\b/i)
    if (idx !== -1 && !/<\/\s*thinking\s*>/i.test(t.slice(idx))) {
      t = t.slice(0, idx)
    }
  }
  return t
}

type ChatSegment = { kind: "body" | "think"; body: string; tag?: string }

/** 将正文与 <thinking> / <thought> 等块拆开，思考块单独用折叠 UI 展示 */
function splitAssistantSegments(raw: string): ChatSegment[] {
  const str = stripDocumentWrapperTags(raw)
  const segments: ChatSegment[] = []
  let i = 0
  let guard = 0
  while (i < str.length && guard++ < 500) {
    const slice = str.slice(i)
    const open = slice.match(
      /^([\s\S]*?)<(thinking|thought|think|reasoning|analysis|redacted_thinking)(?:\s[^>]*)?>/i
    )
    if (!open) {
      const tail = str.slice(i)
      if (tail) segments.push({ kind: "body", body: tail })
      break
    }
    if (open[1]) segments.push({ kind: "body", body: open[1] })
    const tag = open[2].toLowerCase()
    const afterOpen = i + open[0].length
    const closeRe = new RegExp(`</\\s*${tag}\\s*>`, "i")
    const tailFromOpen = str.slice(afterOpen)
    const closeMatch = tailFromOpen.match(closeRe)
    if (!closeMatch || closeMatch.index === undefined) {
      segments.push({ kind: "body", body: str.slice(i) })
      break
    }
    const inner = tailFromOpen.slice(0, closeMatch.index).trim()
    segments.push({ kind: "think", body: inner, tag })
    i = afterOpen + closeMatch.index + closeMatch[0].length
  }
  return segments.length ? segments : [{ kind: "body", body: str }]
}

/** 复制用：优先只要正文段落；若只有思考块则回退为去掉标签后的全文 */
function assistantPlainTextForCopy(raw: string): string {
  // 复制时不应该把 `（已停止生成）`/`（未能完整保存：xxx）` 也带走
  const { body } = extractTailNotice(raw)
  const cleaned = sanitizeAssistantDisplay(body, false)
  const bodyOnly = splitAssistantSegments(cleaned)
    .filter((s) => s.kind === "body")
    .map((s) => s.body)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (bodyOnly) return bodyOnly
  return sanitizeAssistantDisplay(body, false).trim()
}

async function copyTextToClipboard(text: string): Promise<void> {
  const t = text ?? ""
  if (!t) return
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined
  if (clip && typeof clip.writeText === "function") {
    try {
      await clip.writeText(t)
      return
    } catch {
      /* 无权限等：走降级 */
    }
  }
  const ta = document.createElement("textarea")
  ta.value = t
  ta.setAttribute("readonly", "")
  ta.style.position = "fixed"
  ta.style.left = "-9999px"
  ta.style.top = "0"
  document.body.appendChild(ta)
  try {
    ta.focus()
    ta.select()
    const ok = document.execCommand("copy")
    if (!ok) throw new Error("execCommand copy returned false")
  } finally {
    ta.remove()
  }
}

/**
 * 把渲染后的助手消息（粗体 / 标题 / 列表 / 引用 / 代码块等）以富文本形式复制，
 * 同时附带 markdown 源码作为 plain 兜底，让 Word/邮件粘出对应格式，记事本/IDE 粘出原文。
 *
 * 实现：
 * - 找到 [data-msg-id] 节点克隆，剥掉 React 内部属性、tooltip、复制/反馈按钮等噪音
 * - 用 ClipboardItem 同时写 text/html + text/plain
 * - 不支持 ClipboardItem 的浏览器：降级写 plain（与原行为一致）
 */
function buildHtmlFromMessageNode(node: HTMLElement): string {
  const cloned = node.cloneNode(true) as HTMLElement
  // 移除「思考过程」可折叠块（避免把分析内容也粘到 Word）
  cloned.querySelectorAll("details, summary").forEach((el) => el.remove())
  // 移除任何标了 data-no-copy 的辅助元素（错误 banner / 状态条等）
  cloned.querySelectorAll("[data-no-copy]").forEach((el) => el.remove())
  // 清理 React 内部 / 组件库残留属性，避免 Word 报错或乱嵌入数据
  const attrBlacklistPrefix = ["data-radix", "data-state", "data-msg-id", "data-md-body"]
  const treeWalk = (el: Element) => {
    Array.from(el.attributes).forEach((a) => {
      const n = a.name
      if (n.startsWith("on") || attrBlacklistPrefix.some((p) => n.startsWith(p))) {
        el.removeAttribute(n)
      }
    })
    Array.from(el.children).forEach(treeWalk)
  }
  treeWalk(cloned)
  // 包一层 body 让 Word 识别为 HTML 文档片段；保留基础排版样式（行距、字号）
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:'PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.85;color:#1f2937;">${cloned.innerHTML}</body></html>`
}

/**
 * Legacy 富文本复制：用 Selection + execCommand("copy") 复制 DOM 节点的渲染结果。
 * 适用 HTTP 部署或不支持 ClipboardItem 的浏览器。Word/WPS 会拿到 text/html，记事本拿 text/plain。
 */
function copyRichViaSelection(sourceNode: HTMLElement): boolean {
  if (typeof document === "undefined") return false
  const wrapper = document.createElement("div")
  wrapper.contentEditable = "true"
  wrapper.style.position = "fixed"
  wrapper.style.left = "-99999px"
  wrapper.style.top = "0"
  wrapper.style.opacity = "0"
  wrapper.style.pointerEvents = "none"
  wrapper.style.userSelect = "text"
  wrapper.innerHTML = sourceNode.innerHTML
  document.body.appendChild(wrapper)

  const selection = window.getSelection()
  const prevRanges: Range[] = []
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i++) {
      prevRanges.push(selection.getRangeAt(i).cloneRange())
    }
    selection.removeAllRanges()
  }

  const range = document.createRange()
  range.selectNodeContents(wrapper)
  selection?.addRange(range)

  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }

  selection?.removeAllRanges()
  for (const r of prevRanges) selection?.addRange(r)
  wrapper.remove()
  return ok
}

async function copyAssistantRich(messageId: number, fallbackMarkdown: string): Promise<void> {
  if (typeof window === "undefined") return
  const node = document.querySelector<HTMLElement>(`[data-msg-id="${messageId}"][data-md-body]`)
  const plain = assistantPlainTextForCopy(fallbackMarkdown)

  // ① 优先：现代 ClipboardItem API（HTTPS / secure context 下可用）
  const canRichModern =
    typeof window.ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === "function"

  if (node && canRichModern) {
    try {
      const html = buildHtmlFromMessageNode(node)
      const item = new window.ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      })
      await navigator.clipboard.write([item])
      return
    } catch {
      /* HTTP / 权限拒绝 → 走 ② */
    }
  }

  // ② 兼容：legacy execCommand + Selection（HTTP 环境也能拿到富文本）
  if (node && copyRichViaSelection(node)) return

  // ③ 兜底：纯文本（用渲染后的 innerText 而不是 markdown 源码，避免出现 # / ** 等符号）
  const plainFallback = node?.innerText?.trim() || plain
  await copyTextToClipboard(plainFallback)
}

function CodeBlockWithHeader({
  language,
  source,
}: {
  language: string
  source: string
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await copyTextToClipboard(source)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error(e)
    }
  }
  return (
    <div className="not-prose my-3 overflow-hidden rounded-xl border border-slate-700/40 bg-[#282c34] text-[13px] shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-700/40 bg-slate-800/60 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-300/90">
          {language}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-slate-300/90 transition hover:bg-slate-700/60 hover:text-white"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> 已复制
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> 复制
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark as Record<string, React.CSSProperties>}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          background: "transparent",
          fontSize: "13px",
        }}
      >
        {source}
      </SyntaxHighlighter>
    </div>
  )
}

/**
 * 给 ReactMarkdown 一份共享 plugin 配置：
 * - remark-gfm：GFM 扩展（表格 / 删除线 / 任务清单 / 自动链接）
 * - remark-math + rehype-katex：渲染 $...$ / $$...$$ 数学公式
 * - rehype-raw：解析 LLM 偶尔吐出的原生 HTML（<kbd>、<sub>、<sup>、<mark>、<u>、<details> 等）
 * - rehype-sanitize：基于扩展白名单兜底过滤，不让 raw HTML 引入 XSS
 */
const chatRemarkPlugins = [remarkGfm, remarkMath]

const chatSanitizeSchema = (() => {
  const tagNames = Array.from(
    new Set([
      ...(defaultSchema.tagNames || []),
      "kbd",
      "sub",
      "sup",
      "mark",
      "u",
      "details",
      "summary",
      "ins",
      "del",
      "abbr",
      "small",
    ]),
  )
  // 在 katex 节点上保留必要 className/style，让公式样式不被剥掉
  const attributes = {
    ...(defaultSchema.attributes || {}),
    "*": [
      ...(((defaultSchema.attributes || {})["*"]) || []),
      "className",
      "style",
    ],
    code: [
      ...(((defaultSchema.attributes || {})["code"]) || []),
      "className",
    ],
    span: [
      ...(((defaultSchema.attributes || {})["span"]) || []),
      "className",
      "style",
    ],
    div: [
      ...(((defaultSchema.attributes || {})["div"]) || []),
      "className",
      "style",
    ],
    a: [
      ...(((defaultSchema.attributes || {})["a"]) || []),
      "href",
      "title",
      "target",
      "rel",
    ],
    img: [
      ...(((defaultSchema.attributes || {})["img"]) || []),
      "src",
      "alt",
      "title",
      "loading",
    ],
  }
  return { ...defaultSchema, tagNames, attributes }
})()

const chatRehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, chatSanitizeSchema],
  rehypeKatex,
] as const

/**
 * 图片放大 lightbox 的 context：MessageContent 内 <img> 通过它拿到 page 级
 * 的开图函数，无需把回调一路 prop drill 下来。
 */
const ChatLightboxCtx = createContext<((src: string, alt?: string) => void) | null>(null)

function ChatImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const open = useContext(ChatLightboxCtx)
  const { src, alt, className, onClick, ...rest } = props
  const handleClick: React.MouseEventHandler<HTMLImageElement> = (e) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    if (open && typeof src === "string" && src) open(src, alt)
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      src={src}
      alt={alt || ""}
      loading="lazy"
      onClick={handleClick}
      className={cn(className, "cursor-zoom-in transition hover:opacity-90")}
    />
  )
}

function ChatLink({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal = typeof href === "string" && /^https?:\/\//i.test(href)
  return (
    <a
      {...rest}
      href={href}
      target={isExternal ? "_blank" : rest.target}
      rel={isExternal ? "noopener noreferrer" : rest.rel}
    >
      {children}
    </a>
  )
}

const chatMarkdownComponents = {
  pre({ children }: { children?: ReactNode }) {
    return <>{children}</>
  },
  code({
    className,
    children,
    ...props
  }: {
    className?: string
    children?: ReactNode
  } & HTMLAttributes<HTMLElement>) {
    const match = /language-(\w+)/.exec(className || "")
    const isBlock = !!match
    if (isBlock) {
      return (
        <CodeBlockWithHeader
          language={match[1]}
          source={String(children).replace(/\n$/, "")}
        />
      )
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
  a: ChatLink,
  img: ChatImage,
}

/**
 * 流式途中可能出现"代码块还没收到结束 ``` 三连点"的瞬态。此时 react-markdown 会
 * 把后续所有内容一直当成代码块，直到收到关闭符。视觉上整段文案塌成黑底，体验差。
 *
 * 这里在流式状态下若末尾的 ``` 数量为奇数，临时补一个虚拟 ``` 让它先完结，
 * 等下个 token 到来重新判断时自然恢复。仅影响显示，不污染 raw content。
 */
function autoCloseUnfinishedFence(input: string): string {
  if (!input) return input
  const fenceCount = (input.match(/```/g) || []).length
  if (fenceCount % 2 === 1) {
    return input + "\n```"
  }
  return input
}

/**
 * 从助手消息末尾识别 `（已停止生成）` / `（未能完整保存：xxx）` 之类的状态尾标，
 * 单独抽出来交给红色 banner 渲染，正文里去掉这一行——这样：
 * - 错误信息有醒目的视觉区分（不是和正文一坨黑字）
 * - 复制 / 导出时不会把"已停止生成"也带走
 */
type AssistantTailNotice =
  | { kind: "aborted" }
  | { kind: "error"; message: string }
  | { kind: "error_only"; message: string }

function extractTailNotice(content: string): {
  body: string
  notice: AssistantTailNotice | null
} {
  if (!content) return { body: content, notice: null }
  const t = content.replace(/\s+$/, "")

  // a) 末尾 `\n\n—\n（未能完整保存：...）` 由后端 / 前端 catch 分支拼接
  const errMatch = t.match(/\n\n—\n（未能完整保存：([^）]+)）\s*$/)
  if (errMatch) {
    return {
      body: t.slice(0, errMatch.index).replace(/\s+$/, ""),
      notice: { kind: "error", message: errMatch[1] },
    }
  }

  // b) 整条都是"请求失败：xxx" —— 流一字未出错时后端写库的 fallback
  const onlyErrMatch = t.match(/^请求失败：([\s\S]*?)\n+请重试.*$/)
  if (onlyErrMatch) {
    return {
      body: "",
      notice: { kind: "error_only", message: onlyErrMatch[1].trim() },
    }
  }

  // c) 末尾 `\n\n—\n（已停止生成）` 用户中断
  if (/\n\n—\n（已停止生成）\s*$/.test(t)) {
    return {
      body: t.replace(/\n\n—\n（已停止生成）\s*$/, "").replace(/\s+$/, ""),
      notice: { kind: "aborted" },
    }
  }

  // d) 单独一句"（已停止生成）"（一字未出就被中断）
  if (/^（已停止生成）\s*$/.test(t)) {
    return { body: "", notice: { kind: "aborted" } }
  }

  return { body: content, notice: null }
}

/**
 * 图片放大遮罩。点遮罩 / ESC 关闭；不依赖 Dialog 组件，避免引入额外 DOM 复杂度。
 */
function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt?: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || ""}
        className="max-h-[92vh] max-w-[92vw] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        aria-label="关闭"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

function AssistantTailNoticeBanner({ notice }: { notice: AssistantTailNotice }) {
  const isAborted = notice.kind === "aborted"
  const Icon = isAborted ? Square : AlertCircle
  const title = isAborted ? "已停止生成" : "回答未能完整保存"
  const detail = notice.kind === "aborted"
    ? "你主动中断了这次回复，上方是中断前已生成的内容。"
    : notice.message
  const tone = isAborted
    ? "border-slate-200 bg-slate-50/80 text-slate-600"
    : "border-rose-200 bg-rose-50/80 text-rose-700"
  return (
    <div
      data-no-copy
      className={cn(
        "not-prose mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]",
        tone,
      )}
    >
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isAborted ? "text-slate-500" : "text-rose-500")} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {detail ? (
          <div className="mt-0.5 break-words text-[12px] opacity-90">{detail}</div>
        ) : null}
      </div>
    </div>
  )
}

function MessageContent({
  content,
  streaming,
  messageId,
}: {
  content: string
  streaming?: boolean
  /** 复制富文本时定位 DOM 节点的锚点 */
  messageId?: number
}) {
  // 1) 先把尾部状态条（已停止生成 / 未能完整保存）抽出来，独立成红色/灰色 banner，
  //    避免和正文混在一坨黑字里；同时 banner DOM 标 data-no-copy 让复制时被剔除。
  const { body, notice } = useMemo(() => extractTailNotice(content), [content])

  // 2) 流式途中如果出现未闭合的 ```，临时补一个 ```，防止整段被吞进代码块
  const sanitized = useMemo(() => {
    const cleaned = sanitizeAssistantDisplay(body, streaming)
    return streaming ? autoCloseUnfinishedFence(cleaned) : cleaned
  }, [body, streaming])

  const segments = useMemo(() => splitAssistantSegments(sanitized), [sanitized])
  const thinkTitle = (tag?: string) => {
    if (tag === "redacted_thinking") return "思考过程（已脱敏）"
    if (tag === "reasoning" || tag === "analysis") return "推理与分析"
    return "思考过程"
  }

  return (
    <div
      data-msg-id={messageId}
      data-md-body
      className="prose prose-sm max-w-none break-words select-text text-[15px] leading-[1.85] text-slate-800
      prose-p:my-3 prose-p:leading-[1.85]
      prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900
      prose-h1:text-[20px] prose-h1:mt-6 prose-h1:mb-3 prose-h1:pb-2 prose-h1:border-b prose-h1:border-slate-200
      prose-h2:text-[17px] prose-h2:mt-5 prose-h2:mb-2.5
      prose-h3:text-[15px] prose-h3:mt-4 prose-h3:mb-2 prose-h3:text-slate-800
      prose-h4:text-[14px] prose-h4:mt-3 prose-h4:mb-1.5
      prose-ul:my-3 prose-ol:my-3 prose-li:my-1
      [&_ul>li]:marker:text-primary/75 [&_ol>li]:marker:text-primary/85 [&_ol>li]:marker:font-semibold
      [&_ul]:pl-5 [&_ol]:pl-5
      prose-code:text-rose-600 prose-code:bg-slate-100/90 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[13px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none
      prose-pre:my-0 prose-pre:p-0 prose-pre:bg-transparent
      [&_blockquote]:not-italic [&_blockquote]:border-l-4 [&_blockquote]:border-primary/45 [&_blockquote]:bg-primary/[0.07] [&_blockquote]:rounded-r-xl [&_blockquote]:px-4 [&_blockquote]:py-2.5 [&_blockquote]:my-3 [&_blockquote]:text-slate-700
      [&_blockquote_p]:my-1 [&_blockquote_p:before]:content-none [&_blockquote_p:after]:content-none
      prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-2
      prose-strong:font-semibold prose-strong:text-slate-900
      prose-em:text-slate-700
      prose-hr:my-5 prose-hr:border-slate-200
      prose-table:text-[13px] prose-table:my-3 prose-table:border prose-table:border-slate-200 prose-table:rounded-lg prose-table:overflow-hidden
      [&_thead]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-slate-700 [&_th]:border-b [&_th]:border-slate-200
      [&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-slate-100
      [&_tbody_tr:nth-child(even)]:bg-slate-50/40
      [&_img]:rounded-lg [&_img]:shadow-sm [&_img]:my-3
      [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-slate-300 [&_kbd]:bg-slate-50 [&_kbd]:px-1.5 [&_kbd]:py-[1px] [&_kbd]:text-[12px] [&_kbd]:font-mono [&_kbd]:text-slate-700 [&_kbd]:shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)]
      [&_mark]:bg-primary/12 [&_mark]:text-foreground [&_mark]:rounded [&_mark]:px-0.5
      [&_sup]:text-[10px] [&_sub]:text-[10px]
      [&_input[type=checkbox]]:!appearance-none [&_input[type=checkbox]]:!h-[15px] [&_input[type=checkbox]]:!w-[15px] [&_input[type=checkbox]]:!align-[-2px] [&_input[type=checkbox]]:!rounded-[4px] [&_input[type=checkbox]]:!border [&_input[type=checkbox]]:!border-slate-300 [&_input[type=checkbox]]:!bg-white [&_input[type=checkbox]]:!mr-1.5
      [&_input[type=checkbox]:checked]:!border-emerald-500 [&_input[type=checkbox]:checked]:!bg-emerald-500 [&_input[type=checkbox]:checked]:!bg-[url('data:image/svg+xml;utf8,<svg_xmlns=%22http://www.w3.org/2000/svg%22_viewBox=%220_0_24_24%22_fill=%22none%22_stroke=%22white%22_stroke-width=%223%22_stroke-linecap=%22round%22_stroke-linejoin=%22round%22><polyline_points=%2220_6_9_17_4_12%22/></svg>')] [&_input[type=checkbox]:checked]:!bg-center [&_input[type=checkbox]:checked]:!bg-no-repeat [&_input[type=checkbox]:checked]:!bg-[length:11px_11px]
      [&_li:has(>input[type=checkbox])]:list-none [&_li:has(>input[type=checkbox])]:!pl-0 [&_li:has(>input[type=checkbox])]:!ml-[-1.25rem]
      [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1
      [&_.katex]:text-[1em]"
    >
      {segments.map((seg, idx) =>
        seg.kind === "think" ? (
          <details
            key={`think-${idx}`}
            data-no-copy
            className="not-prose my-3 rounded-xl border border-primary/20 bg-gradient-to-b from-primary/[0.06] to-slate-50/40 text-[14px] shadow-sm open:shadow-md"
          >
            <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                {thinkTitle(seg.tag)}
                <span className="text-xs font-normal text-primary/75">（点击展开）</span>
              </span>
            </summary>
            <div className="border-t border-primary/10 px-3 py-2.5 text-slate-700">
              {seg.body ? (
                <ReactMarkdown
                  remarkPlugins={chatRemarkPlugins}
                  rehypePlugins={chatRehypePlugins as never}
                  components={chatMarkdownComponents}
                >
                  {seg.body}
                </ReactMarkdown>
              ) : (
                <p className="text-xs text-slate-500">（无可见内容）</p>
              )}
            </div>
          </details>
        ) : (
          <ReactMarkdown
            key={`md-${idx}`}
            remarkPlugins={chatRemarkPlugins}
            rehypePlugins={chatRehypePlugins as never}
            components={chatMarkdownComponents}
          >
            {seg.body}
          </ReactMarkdown>
        )
      )}
      {streaming &&
        (content ? (
          <StreamingDots />
        ) : (
          <span className="inline-flex items-center gap-1">
            <StreamingDots />
          </span>
        ))}
      {!streaming && notice ? <AssistantTailNoticeBanner notice={notice} /> : null}
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
  const [cleaningEmpty, setCleaningEmpty] = useState(false)
  /** 待确认删除的会话；非空时弹出确认对话框 */
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)
  /** 是否显示「清理空会话」确认对话框 */
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  /** 桌面侧栏宽度（px），可拖动调整；移动端不生效 */
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [resizingSidebar, setResizingSidebar] = useState(false)
  const sidebarWidthRef = useRef(280)

  /** 助手消息里点开的图片 lightbox（消息中 <img> 通过 ChatLightboxCtx 触发） */
  const [openedImage, setOpenedImage] = useState<{ src: string; alt?: string } | null>(null)
  const openLightbox = useCallback((src: string, alt?: string) => {
    setOpenedImage({ src, alt })
  }, [])

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
  const activeSessionRef = useRef<ChatSession | null>(null)
  const scrollFollowRafRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
  /** 当前流式请求的中止控制器，点击停止按钮时 abort()，后端 is_disconnected 自动停止 LLM。 */
  const streamAbortRef = useRef<AbortController | null>(null)
  /** 实时追踪每个 session 正在进行的流式内容，切换 session 再切回时用于恢复显示。
   *  done=true 表示流已结束（含出错），内容保留供切回时展示；发新消息时会被覆盖。 */
  const liveStreamRef = useRef<Map<number, { content: string; msgId: number; done?: boolean }>>(new Map())
  /** 流式结束时若用户已切到其它会话，在此暂存 reconcile 参数，切回本会话时与 getMessages 结果合并 */
  const pendingChatReconcileRef = useRef<
    Map<
      number,
      {
        streamedAssistant: string
        optimisticAssistantId: number
        streamError: string | null
        aborted?: boolean
      }
    >
  >(new Map())

  const displayName = useMemo(() => {
    if (!user?.email) return "用户"
    return user.email.split("@")[0] ?? user.email
  }, [user])

  useEffect(() => {
    activeSessionRef.current = activeSession
  }, [activeSession])

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem(CHAT_MODEL_STORAGE_KEY)
        : null
    if (saved && CHAT_MODEL_OPTIONS.some((m) => m.id === saved)) {
      setSelectedModel(saved)
    }
  }, [])

  const sidebarAsideRef = useRef<HTMLDivElement>(null)

  // 加载侧栏宽度
  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem("chat-sidebar-width")
    if (saved) {
      const n = parseInt(saved, 10)
      if (!Number.isNaN(n) && n >= 220 && n <= 520) {
        setSidebarWidth(n)
        sidebarWidthRef.current = n
      }
    }
  }, [])

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  const startResizingSidebar = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const aside = sidebarAsideRef.current
    const startX = e.clientX
    const startW = sidebarWidthRef.current
    setResizingSidebar(true)
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(220, Math.min(520, startW + (ev.clientX - startX)))
      sidebarWidthRef.current = next
      if (aside) aside.style.width = `${next}px`
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
      setResizingSidebar(false)
      const w = sidebarWidthRef.current
      setSidebarWidth(w)
      if (aside) aside.style.width = `${w}px`
      try {
        localStorage.setItem("chat-sidebar-width", String(w))
      } catch {}
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [])

  useEffect(() => {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel)
  }, [selectedModel])

  /** 只在消息列表容器内滚动，避免 scrollIntoView 带动整页/侧栏导致卡顿与点击失灵 */
  const scrollMessagesToBottom = useCallback(() => {
    const el = messagesScrollRef.current
    if (!el || !followStreamOutputRef.current) return
    if (scrollFollowRafRef.current != null) return
    scrollFollowRafRef.current = window.requestAnimationFrame(() => {
      scrollFollowRafRef.current = null
      const box = messagesScrollRef.current
      if (!box || !followStreamOutputRef.current) return
      box.scrollTop = box.scrollHeight
    })
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
    scrollMessagesToBottom()
  }, [messages, scrollMessagesToBottom])

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
    const sid = activeSession.id
    chatApi
      .getMessages(sid)
      .then((rows) => {
        if (activeSessionRef.current?.id !== sid) return

        // 1. 该 session 仍在流式输出中（done=false）：把流式增量合并到末尾
        const live = liveStreamRef.current.get(sid)
        if (live && !live.done) {
          const base = [...rows] as DisplayMessage[]
          const idx = base.findLastIndex((m) => m.role === "assistant")
          const streamingMsg: DisplayMessage = {
            id: live.msgId,
            role: "assistant",
            content: live.content,
            model: null,
            created_at: new Date().toISOString(),
            streaming: true,
          }
          if (idx >= 0 && base[idx].id === live.msgId) {
            base[idx] = streamingMsg
          } else {
            base.push(streamingMsg)
          }
          setMessages(base)
          return
        }

        // 2. 流已结束（含中断）但用户切走过：合并 pending reconcile 信息或 liveStreamRef 残留。
        //    后端 fire-and-forget 持久化生成的 DB id 与前端 optimisticAssistantId 不一致，
        //    必须走 reconcileChatMessages 让它去重 + 应用「（已停止生成）」尾标签。
        const pending = pendingChatReconcileRef.current.get(sid)
        if (pending) {
          setMessages(
            reconcileChatMessages(
              rows,
              pending.streamedAssistant,
              pending.optimisticAssistantId,
              pending.streamError,
              pending.aborted ?? false
            )
          )
          pendingChatReconcileRef.current.delete(sid)
        } else if (live && live.done) {
          // 没有 pending 但 liveStreamRef 仍标记本会话上次中断/出错的最终内容，覆盖到 server 末条助手。
          const base = [...rows] as DisplayMessage[]
          const idx = base.findLastIndex((m) => m.role === "assistant")
          const finalMsg: DisplayMessage = {
            id: idx >= 0 ? base[idx].id : live.msgId,
            role: "assistant",
            content: live.content,
            model: idx >= 0 ? base[idx].model : null,
            created_at: idx >= 0 ? base[idx].created_at : new Date().toISOString(),
            streaming: false,
          }
          if (idx >= 0) {
            base[idx] = finalMsg
          } else {
            base.push(finalMsg)
          }
          setMessages(base)
        } else {
          setMessages(rows)
        }
      })
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
        attachments: attachments?.length
          ? optimisticMessageAttachments(attachments)
          : null,
      }
      const assistantMsg: DisplayMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: "",
        model: null,
        created_at: new Date().toISOString(),
        streaming: true,
      }
      pendingChatReconcileRef.current.delete(session.id)
      setMessages((prev) => {
        if (activeSessionRef.current?.id !== session.id) return prev
        return [...prev, userMsg, assistantMsg]
      })
      followStreamOutputRef.current = true

      // 初始化 liveStreamRef，让切回时能看到正在生成的内容
      liveStreamRef.current.set(session.id, { content: "", msgId: assistantMsg.id })

      let streamedAssistant = ""
      let streamError: string | null = null
      let aborted = false

      // 新建中止控制器并暴露给 UI（停止按钮）
      const controller = new AbortController()
      streamAbortRef.current?.abort()
      streamAbortRef.current = controller

      try {
        const res = await chatApi.streamMessage(
          session.id,
          content,
          modelForStream,
          attachments,
          context,
          controller.signal
        )
        streamedAssistant = await consumeChatSSE(
          res,
          (acc) => {
            liveStreamRef.current.set(session.id, { content: acc, msgId: assistantMsg.id })
            setMessages((prev) => {
              if (activeSessionRef.current?.id !== session.id) return prev
              return prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: acc, streaming: true } : m
              )
            })
          },
          controller.signal
        )
      } catch (e: unknown) {
        if (e instanceof StreamAbortedByUser) {
          aborted = true
          const partial = e.partialAssistantText || ""
          if (partial) streamedAssistant = partial
        } else {
          streamError = e instanceof Error ? e.message : String(e)
          const partial = streamErrorPartial(e)
          if (partial) streamedAssistant = partial
        }
        // 出错或中断时把已收到内容存入 liveStreamRef 并标记 done，
        // 这样切走再切回仍能看到已生成的正文，不会变空
        const tail = aborted
          ? streamedAssistant.trim()
            ? `${streamedAssistant.trim()}\n\n—\n（已停止生成）`
            : "（已停止生成）"
          : streamError && streamedAssistant.trim()
            ? `${streamedAssistant.trim()}\n\n—\n（未能完整保存：${streamError}）`
            : ""
        if (tail) {
          liveStreamRef.current.set(session.id, { content: tail, msgId: assistantMsg.id, done: true })
        }
      } finally {
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null
        }
        // 正常完成才清 liveStreamRef；abort 或错误都保留（done:true），切回时仍能看到已生成内容
        if (!streamError && !aborted) {
          liveStreamRef.current.delete(session.id)
        }
        const sid = session.id
        const wasAborted = aborted
        // 中断 / 出错时后端用 fire-and-forget 写库，可能比 getMessages 还慢；
        // 短延迟一拍，让数据库先落定，避免 reconcile 拿到旧快照后又被实时数据覆盖。
        const fetchDelay = wasAborted || streamError ? 350 : 0
        const fetchAfter = fetchDelay > 0 ? new Promise((r) => setTimeout(r, fetchDelay)) : Promise.resolve()
        fetchAfter
          .then(() => chatApi.getMessages(sid))
          .then((serverMsgs) => {
            const act = activeSessionRef.current
            if (act?.id === sid) {
              pendingChatReconcileRef.current.delete(sid)
              setMessages(
                reconcileChatMessages(
                  serverMsgs,
                  streamedAssistant,
                  assistantMsg.id,
                  streamError,
                  wasAborted
                )
              )
            } else if (streamError || wasAborted || streamedAssistant.trim()) {
              pendingChatReconcileRef.current.set(sid, {
                streamedAssistant,
                optimisticAssistantId: assistantMsg.id,
                streamError,
                aborted: wasAborted,
              })
            }
          })
          .catch(() => {
            if (activeSessionRef.current?.id !== sid) return
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, streaming: false } : m
              )
            )
          })
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
      let content = (detail.content ?? "").trim()
      if (!content && detail.segments?.length) {
        content = [...detail.segments]
          .sort((a, b) => a.index - b.index)
          .map((s) => (s.content ?? "").trim())
          .filter(Boolean)
          .join("\n\n")
      }
      if (!content) {
        window.alert("未能加载正文：请确认任务已生成完成，或稍后重试。")
        return
      }
      setLinkedTask({ id: taskId, title, content })
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
      activeSessionRef.current = session
      setMobileNavOpen(false)
    } catch (e) {
      console.error(e)
    }
  }

  /** 仅打开确认弹窗，真正删除发生在 confirmDeleteSession */
  const handleDeleteSession = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setSessionToDelete(session)
  }

  const confirmDeleteSession = async () => {
    if (!sessionToDelete || deletingSession) return
    const target = sessionToDelete
    setDeletingSession(true)
    try {
      await chatApi.deleteSession(target.id)
      setSessions((prev) => prev.filter((s) => s.id !== target.id))
      if (activeSession?.id === target.id) {
        setActiveSession(null)
        activeSessionRef.current = null
      }
      setSessionToDelete(null)
    } catch (e) {
      console.error(e)
      window.alert("删除失败，请稍后重试")
    } finally {
      setDeletingSession(false)
    }
  }

  /** 仅打开确认弹窗 */
  const handleCleanupEmptySessions = () => {
    if (cleaningEmpty) return
    setCleanupConfirmOpen(true)
  }

  const confirmCleanupEmptySessions = async () => {
    if (cleaningEmpty) return
    setCleaningEmpty(true)
    try {
      const res = await chatApi.cleanupEmptySessions()
      const removed = new Set(res.deleted_ids)
      if (removed.size > 0) {
        setSessions((prev) => prev.filter((s) => !removed.has(s.id)))
        if (activeSession && removed.has(activeSession.id)) {
          setActiveSession(null)
          activeSessionRef.current = null
        }
      }
      setCleanupConfirmOpen(false)
      // 弹一个轻量提示（沿用 alert 即可，不阻断主流程）
      setTimeout(() => {
        if (res.deleted_count === 0) {
          window.alert("没有可清理的空会话")
        } else {
          window.alert(`已清理 ${res.deleted_count} 个空会话`)
        }
      }, 50)
    } catch (e) {
      console.error(e)
      window.alert("清理失败，请稍后重试")
    } finally {
      setCleaningEmpty(false)
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
    if ((!text && !attachments) || sending || sendingRef.current) return

    sendingRef.current = true
    setSending(true)

    setInput("")
    setPendingAttachments([])

    let session = activeSession
    const titleHint = text || "图片或附件"

    if (!session) {
      try {
        session = await chatApi.createSession(titleHint.slice(0, 24))
        setSessions((prev) => [session!, ...prev])
        setActiveSession(session)
        activeSessionRef.current = session
      } catch (e) {
        sendingRef.current = false
        setSending(false)
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

    try {
      await streamToSession(
        session,
        text,
        selectedModel,
        attachments,
        linkedTask ? { type: "editor_content", content: linkedTask.content } : undefined
      )
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const handleRegenerate = async (assistantMsgId: number) => {
    if (sending || !activeSession) return
    const regenSessionId = activeSession.id
    const assistantMsg = messages.find((m) => m.id === assistantMsgId)
    const modelToUse = assistantMsg?.model ?? selectedModel

    setMessages((prev) => {
      if (activeSessionRef.current?.id !== regenSessionId) return prev
      return prev.map((m) =>
        m.id === assistantMsgId ? { ...m, content: "", streaming: true } : m
      )
    })
    setSending(true)
    sendingRef.current = true
    followStreamOutputRef.current = true
    pendingChatReconcileRef.current.delete(regenSessionId)

    let streamedAssistant = ""
    let streamError: string | null = null
    let aborted = false

    const controller = new AbortController()
    streamAbortRef.current?.abort()
    streamAbortRef.current = controller

    try {
      const res = await chatApi.regenerateStream(
        regenSessionId,
        assistantMsgId,
        modelToUse,
        controller.signal
      )
      streamedAssistant = await consumeChatSSE(
        res,
        (acc) => {
          setMessages((prev) => {
            if (activeSessionRef.current?.id !== regenSessionId) return prev
            return prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: acc, streaming: true } : m
            )
          })
        },
        controller.signal
      )
    } catch (e: unknown) {
      if (e instanceof StreamAbortedByUser) {
        aborted = true
        const partial = e.partialAssistantText || ""
        if (partial) streamedAssistant = partial
      } else {
        streamError = e instanceof Error ? e.message : String(e)
        const partial = streamErrorPartial(e)
        if (partial) streamedAssistant = partial
      }
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
      sendingRef.current = false
      setSending(false)
      const wasAborted = aborted
      const fetchDelay = wasAborted || streamError ? 350 : 0
      const fetchAfter = fetchDelay > 0 ? new Promise((r) => setTimeout(r, fetchDelay)) : Promise.resolve()
      fetchAfter
        .then(() => chatApi.getMessages(regenSessionId))
        .then((serverMsgs) => {
          const act = activeSessionRef.current
          if (act?.id === regenSessionId) {
            pendingChatReconcileRef.current.delete(regenSessionId)
            setMessages(
              reconcileChatMessages(
                serverMsgs,
                streamedAssistant,
                assistantMsgId,
                streamError,
                wasAborted
              )
            )
          } else if (streamError || wasAborted || streamedAssistant.trim()) {
            pendingChatReconcileRef.current.set(regenSessionId, {
              streamedAssistant,
              optimisticAssistantId: assistantMsgId,
              streamError,
              aborted: wasAborted,
            })
          }
        })
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
          首页
        </Link>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-500 hover:text-rose-600"
            onClick={handleCleanupEmptySessions}
            disabled={cleaningEmpty || sessions.length === 0}
            title="清理空会话（删除所有没有消息的会话）"
          >
            {cleaningEmpty ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eraser className="h-4 w-4" />
            )}
          </Button>
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
                  activeSessionRef.current = session
                  setMobileNavOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setActiveSession(session)
                    activeSessionRef.current = session
                    setMobileNavOpen(false)
                  }
                }}
                className={cn(
                  "group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                  activeSession?.id === session.id
                    ? "bg-white shadow-sm ring-1 ring-primary/20"
                    : "hover:bg-white/70 text-slate-700"
                )}
              >
                <span className="min-w-0 truncate">{session.title}</span>
                <button
                  type="button"
                  onClick={(e) => handleDeleteSession(session, e)}
                  title="删除会话"
                  aria-label="删除会话"
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200/80 text-slate-500 transition hover:bg-rose-500 hover:text-white"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-slate-200/80 p-3">
        <div className="rounded-xl bg-white/90 p-3 shadow-sm ring-1 ring-slate-200/60">
          <div className="flex items-center gap-2">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
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
    <ChatLightboxCtx.Provider value={openLightbox}>
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {/* 桌面侧栏（可拖动调整宽度） */}
      <aside
        ref={sidebarAsideRef}
        className="relative hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex"
        style={{ width: `${sidebarWidth}px` }}
      >
        <div className="flex items-center gap-2 border-b border-slate-200/80 px-4 py-3">
          <BrandMark size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {BRAND_NAME}
            </p>
            <p className="text-[11px] text-muted-foreground">对话</p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{SidebarBody}</div>
        {/* 右边缘拖动条：可调侧栏宽度（220~480px）；双击恢复默认 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整侧栏宽度"
          onMouseDown={startResizingSidebar}
          onDoubleClick={() => {
            setSidebarWidth(280)
            sidebarWidthRef.current = 280
            if (sidebarAsideRef.current) sidebarAsideRef.current.style.width = "280px"
            try {
              localStorage.setItem("chat-sidebar-width", "280")
            } catch {}
          }}
          className={cn(
            "absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30",
            resizingSidebar && "bg-primary/45"
          )}
          title="拖动调整宽度（双击恢复默认）"
        />
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
          fileDragOver && "bg-primary/10 ring-2 ring-inset ring-primary/35"
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
                  className="gap-1.5 text-xs border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                  onClick={async () => {
                    if (sending || sendingRef.current) return
                    const text = "请帮我全面检查这篇文章"
                    setInput("")
                    sendingRef.current = true
                    setSending(true)
                    try {
                      let session = activeSession
                      if (!session) {
                        try {
                          session = await chatApi.createSession(text.slice(0, 24))
                          setSessions((prev) => [session!, ...prev])
                          setActiveSession(session)
                          activeSessionRef.current = session
                        } catch (e) {
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
                    } finally {
                      sendingRef.current = false
                      setSending(false)
                    }
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
            <div className="flex items-center gap-2 border-t border-primary/10 bg-primary/5 px-4 py-1.5 text-xs text-foreground">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span>已关联：<span className="font-medium">{linkedTask.title}</span></span>
              <span className="text-primary">·</span>
              <span>{linkedTask.content.length > 0 ? `${Math.round(linkedTask.content.replace(/[^\u4e00-\u9fff]/g, '').length)}+ 字` : "空文章"}</span>
              <button
                className="ml-auto text-primary hover:text-foreground"
                onClick={() => setLinkedTask(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </header>

        {/* 公告条 */}
        <div className="shrink-0 border-b border-primary/15 bg-primary/5 px-4 py-2 text-center text-[11px] text-foreground/90 sm:text-xs">
          支持将<span className="font-medium">图片 / PDF / Word（.docx）/ 文本</span>
          拖入此区域或输入框。文档在对话中以卡片展示，不展开全文。模型需支持识图/读文档（如 Sonnet、Opus）。
        </div>

        {/* 消息区 */}
        <div
          ref={messagesScrollRef}
          onScroll={onMessagesScroll}
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-32 pt-6 md:px-12"
        >
          {!activeSession ? (
            <div className="flex min-h-[48vh] flex-col items-center justify-center gap-6 px-2 text-center">
              <p className="font-serif text-3xl font-normal tracking-tight text-slate-800 md:text-4xl">
                <span className="mr-2 inline-block text-primary">☀</span>
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
                    className="rounded-full border border-slate-200/90 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:border-primary/30 hover:bg-primary/5"
                    onClick={() => setInput((prev) => (prev ? `${prev}\n${t}` : t))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-slate-600">
              <Bot className="h-12 w-12 text-primary/20" />
              <p className="text-sm font-medium text-slate-800">
                新会话「{activeSession.title}」
              </p>
              <p className="max-w-sm text-xs text-slate-500">
                在下方输入第一条消息，或换一个模型后再开始。
              </p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[min(100%,1400px)] space-y-8 pb-8">
              {messages.map((msg) => (
                <div key={msg.id} className="group/msg">
                  {msg.role === "user" ? (
                    <div className="flex justify-end gap-3">
                      <div className="max-w-[78%] rounded-2xl bg-primary/[0.07] px-4 py-2.5 ring-1 ring-primary/15">
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
                            onCopy={async () => {
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
                              await copyTextToClipboard(t)
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
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15">
                        <Bot className="h-4 w-4 text-primary" />
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
                              messageId={msg.id}
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
                                  copyAssistantRich(
                                    msg.id,
                                    msg.content
                                  )
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
          <div className="pointer-events-auto mx-auto w-full max-w-[min(100%,1400px)] px-4">
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

                {sending ? (
                  <Button
                    size="icon"
                    variant="destructive"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    onClick={() => streamAbortRef.current?.abort()}
                    type="button"
                    title="停止生成"
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    onClick={handleSend}
                    disabled={!input.trim() && pendingAttachments.length === 0}
                    type="button"
                    title="发送"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
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
                title="返回首页"
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

        {/* 删除单个会话 - 确认弹窗 */}
        <AlertDialog
          open={!!sessionToDelete}
          onOpenChange={(open) => {
            if (!open && !deletingSession) setSessionToDelete(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </span>
                删除会话
              </AlertDialogTitle>
              <AlertDialogDescription>
                即将删除会话{" "}
                <span className="font-medium text-slate-900">
                  「{sessionToDelete?.title || "新对话"}」
                </span>
                <br />
                <span className="text-rose-600/90">
                  该会话内的所有消息都会被清除，且无法恢复。
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingSession}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  confirmDeleteSession()
                }}
                disabled={deletingSession}
                className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-300"
              >
                {deletingSession ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    删除中…
                  </>
                ) : (
                  "确认删除"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 清理空会话 - 确认弹窗 */}
        <AlertDialog
          open={cleanupConfirmOpen}
          onOpenChange={(open) => {
            if (!open && !cleaningEmpty) setCleanupConfirmOpen(false)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Eraser className="h-4 w-4" />
                </span>
                清理空会话
              </AlertDialogTitle>
              <AlertDialogDescription>
                将自动删除你名下
                <span className="font-medium text-slate-900">
                  所有「没有任何消息」的会话
                </span>
                。已有消息的会话不会受到影响。
                <br />
                此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cleaningEmpty}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  confirmCleanupEmptySessions()
                }}
                disabled={cleaningEmpty}
                className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/35"
              >
                {cleaningEmpty ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    清理中…
                  </>
                ) : (
                  "立即清理"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
    {openedImage ? (
      <ImageLightbox
        src={openedImage.src}
        alt={openedImage.alt}
        onClose={() => setOpenedImage(null)}
      />
    ) : null}
    </ChatLightboxCtx.Provider>
  )
}

function MessageToolbar({
  onCopy,
  onDelete,
}: {
  onCopy: () => void | Promise<void>
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
          try {
            await Promise.resolve(onCopy())
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch (e) {
            console.error(e)
            window.alert("复制失败，请改为手动选中文字复制")
          }
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
  onCopy: () => void | Promise<void>
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
          try {
            await Promise.resolve(onCopy())
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch (e) {
            console.error(e)
            window.alert("复制失败，请改为手动选中文字复制")
          }
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
          feedback === "up" ? "text-primary" : "text-slate-500"
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
