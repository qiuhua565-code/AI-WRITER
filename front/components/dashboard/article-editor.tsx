"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { flushSync } from "react-dom"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { diffWords } from "diff"
import {
  ArrowLeft,
  CheckCircle,
  Download,
  FileText,
  Clock,
  Loader2,
  Layers,
  XCircle,
  Bot,
  User,
  Send,
  Sparkles,
  Maximize2,
  RotateCcw,
  Save,
  Replace,
  Edit3,
  History,
  RotateCw,
  Trash2,
  GitCompare,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { TaskDetail } from "@/lib/types"
import { tasksApi } from "@/lib/api"

interface ArticleEditorProps {
  task: TaskDetail
}

const statusConfig: Record<string, { label: string; color: string }> = {
  queued:      { label: "排队中",   color: "bg-muted text-muted-foreground" },
  writing:     { label: "生成中",   color: "bg-primary/10 text-primary" },
  plan_review: { label: "待审规划", color: "bg-violet-500/10 text-violet-600" },
  paused:      { label: "已暂停",   color: "bg-amber-500/10 text-amber-600" },
  review:      { label: "待审核",   color: "bg-amber-500/10 text-amber-600" },
  approved:    { label: "已通过",   color: "bg-emerald-500/10 text-emerald-600" },
  rejected:    { label: "已拒绝",   color: "bg-destructive/10 text-destructive" },
  cancelled:   { label: "已取消",   color: "bg-muted text-muted-foreground" },
  failed:      { label: "失败",     color: "bg-destructive/10 text-destructive" },
}

const segmentLabels: Record<string, string> = {
  chapter_1:  "第一章",
  chapter_2:  "第二章",
  chapter_3:  "第三章",
  chapter_4:  "第四章",
  chapter_5:  "第五章",
  chapter_6:  "第六章",
  chapter_7:  "第七章",
  chapter_8:  "第八章",
  chapter_9:  "第九章",
  chapter_10: "第十章",
  chapter_11: "第十一章",
  chapter_12: "第十二章",
  epilogue:   "尾声",
}

const STAGES = [
  { key: "plan",       label: "规划" },
  { key: "chapter_1",  label: "第一章" },
  { key: "chapter_2",  label: "第二章" },
  { key: "chapter_3",  label: "第三章" },
  { key: "chapter_4",  label: "第四章" },
  { key: "chapter_5",  label: "第五章" },
  { key: "chapter_6",  label: "第六章" },
  { key: "chapter_7",  label: "第七章" },
  { key: "chapter_8",  label: "第八章" },
  { key: "chapter_9",  label: "第九章" },
  { key: "chapter_10", label: "第十章" },
  { key: "chapter_11", label: "第十一章" },
  { key: "chapter_12", label: "第十二章" },
  { key: "epilogue",   label: "尾声" },
  { key: "assemble",   label: "组装" },
]

type StageStatus = "waiting" | "writing" | "done" | "failed"

interface StageState {
  [key: string]: StageStatus
}

interface ChatMsg {
  role: "user" | "assistant"
  content: string
  streaming?: boolean
  selectedTextRef?: string
  isActionResponse?: boolean
}

interface ArticleVersion {
  id: number
  label: string
  word_count: number
  preview: string
  created_at: string
}

function getToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem("auth-storage")
    if (!raw) return null
    return JSON.parse(raw)?.state?.token ?? null
  } catch {
    return null
  }
}

/** 按 SSE 规范解析单个事件块（由空行分隔），忽略注释行 `: ...` */
function parseSseEventBlock(block: string): { event: string; data: string } | null {
  const lines = block.replace(/\r/g, "").split("\n")
  let event = ""
  const dataLines: string[] = []
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith(":")) continue
    if (line.startsWith("event:")) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith("data:")) {
      let rest = line.slice(5)
      if (rest.startsWith(" ")) rest = rest.slice(1)
      dataLines.push(rest)
    }
  }
  if (dataLines.length === 0) return null
  return { event: event || "message", data: dataLines.join("\n") }
}

export function ArticleEditor({ task }: ArticleEditorProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showApproveDialog, setShowApproveDialog] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [activeSegment, setActiveSegment] = useState<string | null>(null)

  // Editable content (local copy for in-place edits)
  const [editableContent, setEditableContent] = useState<string>(task.content ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const lastSavedContentRef = useRef<string>(task.content ?? "")

  // Sync editable content when task.content changes externally (e.g. React Query refetch after save)
  useEffect(() => {
    if (!hasUnsaved) {
      setEditableContent(task.content ?? "")
      lastSavedContentRef.current = task.content ?? ""
    }
  }, [task.content]) // eslint-disable-line react-hooks/exhaustive-deps

  // Manual replace: show a textarea for the user to type replacement text
  const [manualReplaceBar, setManualReplaceBar] = useState<{ text: string; replaceTo: string } | null>(null)

  // SSE live progress state (writing/queued)
  const [stages, setStages] = useState<StageState>({})
  const [liveBuffer, setLiveBuffer] = useState("")
  const liveBufferRef = useRef("")   // ref 副本，供 SSE 回调同步读取当前值
  const [completedSegments, setCompletedSegments] = useState<Array<{ type: string; content: string }>>([])
  const sseAbortRef = useRef<AbortController | null>(null)

  // Review AI chat panel
  const instructionDocText =
    typeof task.config?.instruction_doc_text === "string"
      ? String(task.config.instruction_doc_text).trim()
      : ""
  const instructionDocFilename =
    typeof task.config?.instruction_doc_filename === "string"
      ? String(task.config.instruction_doc_filename).trim()
      : ""
  const batchPrompt =
    typeof task.config?.batch_prompt === "string"
      ? String(task.config.batch_prompt).trim()
      : ""
  const targetWordsRaw = task.config?.target_words
  const targetWordsDisplay =
    targetWordsRaw !== undefined && targetWordsRaw !== null && String(targetWordsRaw) !== ""
      ? (() => {
          const n = Number(targetWordsRaw)
          return Number.isFinite(n) ? n : null
        })()
      : null
  const hasInstructionBlock =
    !!instructionDocText || !!batchPrompt || targetWordsDisplay !== null

  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState("")
  const [chatSending, setChatSending] = useState(false)
  const chatMessagesEndRef = useRef<HTMLDivElement>(null)

  // Version history panel
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<ArticleVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [diffView, setDiffView] = useState<{ version: ArticleVersion; content: string } | null>(null)
  const [diffLoading, setDiffLoading] = useState<number | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState<ArticleVersion | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<ArticleVersion | null>(null)

  // Floating toolbar (text selection)
  const [floatingBar, setFloatingBar] = useState<{ x: number; y: number; text: string } | null>(null)
  const floatingBarRef = useRef<HTMLDivElement>(null)

  const isWriting = task.status === "writing" || task.status === "queued"
  const isReviewable = task.status === "review" || task.status === "approved"

  const status = statusConfig[task.status] ?? statusConfig.failed

  // ── SSE live stream ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isWriting) return

    const ctrl = new AbortController()
    sseAbortRef.current = ctrl

    async function connectSSE() {
      try {
        const res = await fetch(`/api/v1/tasks/${task.id}/stream`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
          signal: ctrl.signal,
        })
        if (!res.ok || !res.body) return

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        let currentStage = ""

        const dispatchEvent = (parsed: { event: string; data: string }) => {
          let evt: Record<string, unknown>
          try {
            evt = JSON.parse(parsed.data) as Record<string, unknown>
          } catch {
            return
          }
          const ev =
            parsed.event && parsed.event !== "message"
              ? parsed.event
              : String(evt.type ?? "")

          if (ev === "stage") {
            currentStage = String(evt.stage ?? "")
            setStages(prev => {
              const next = { ...prev }
              Object.keys(next).forEach(k => {
                if (next[k] === "writing") next[k] = "done"
              })
              next[currentStage] = "writing"
              return next
            })
            return
          }

          if (ev === "token" && typeof evt.content === "string" && evt.content.length > 0) {
            liveBufferRef.current += evt.content
            flushSync(() => {
              setLiveBuffer(liveBufferRef.current)
            })
            return
          }

          if (ev === "segment_status" && evt.status === "completed") {
            const savedContent = liveBufferRef.current
            liveBufferRef.current = ""
            flushSync(() => {
              setCompletedSegments(prev => [...prev, { type: currentStage, content: savedContent }])
              setLiveBuffer("")
            })
            setStages(prev => ({ ...prev, [currentStage]: "done" }))
            return
          }

          if (ev === "task_status" || ev === "task_failed") {
            queryClient.invalidateQueries({ queryKey: ["task", task.id] })
            return
          }

          if (ev === "progress" || ev === "plan_ready") {
            queryClient.invalidateQueries({ queryKey: ["task", task.id] })
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            buf += decoder.decode()
            break
          }
          buf += decoder.decode(value, { stream: true })
          buf = buf.replace(/\r\n/g, "\n")

          let sep: number
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            const parsed = parseSseEventBlock(block)
            if (parsed) dispatchEvent(parsed)
          }
        }

        setLiveBuffer(liveBufferRef.current)
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") console.error("SSE error", err)
      }
    }

    connectSSE()
    return () => {
      ctrl.abort()
    }
  }, [task.id, isWriting, queryClient])

  // ── Review chat ──────────────────────────────────────────────────────────────
  const scrollChatToBottom = useCallback(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => { scrollChatToBottom() }, [chatMessages, scrollChatToBottom])

  const sendReviewChat = useCallback(async (message: string, selectedText?: string, action?: string) => {
    if (!message.trim() && !action) return
    setChatSending(true)
    const userContent = message.trim() || `对选中文字执行：${action}`
    const isAction = !!action && !!selectedText

    flushSync(() => {
      setChatMessages(prev => [
        ...prev,
        { role: "user", content: userContent },
        { role: "assistant", content: "", streaming: true, selectedTextRef: isAction ? selectedText : undefined, isActionResponse: isAction },
      ])
    })

    try {
      const res = await fetch(`/api/v1/tasks/${task.id}/review-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({
          message: userContent,
          selected_text: selectedText,
          action,
          segment_type: activeSegment || undefined,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          try {
            const evt = JSON.parse(raw)
            if (evt.type === "token" && evt.content) {
              flushSync(() => {
                setChatMessages(prev => prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: m.content + evt.content } : m
                ))
              })
            } else if (evt.type === "done") {
              setChatMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, streaming: false } : m
              ))
            }
          } catch {}
        }
      }
    } catch {
      setChatMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: "请求失败，请重试。", streaming: false } : m
      ))
    } finally {
      setChatSending(false)
      setChatMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, streaming: false } : m
      ))
    }
  }, [task.id, activeSegment])

  // ── Version history ──────────────────────────────────────────────────────────
  const fetchVersions = useCallback(async () => {
    setVersionsLoading(true)
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}/versions`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      })
      if (res.ok) setVersions(await res.json())
    } finally {
      setVersionsLoading(false)
    }
  }, [task.id])

  const handleRestoreVersion = useCallback(async (versionId: number) => {
    setRestoringId(versionId)
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}/versions/${versionId}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      })
      if (!res.ok) return
      const { content } = await res.json()
      setEditableContent(content)
      setHasUnsaved(false)
      await fetchVersions()
    } finally {
      setRestoringId(null)
    }
  }, [task.id, fetchVersions])

  const handleDeleteVersion = useCallback(async (versionId: number) => {
    setDeletingId(versionId)
    try {
      await fetch(`/api/v1/tasks/${task.id}/versions/${versionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      })
      setVersions(prev => prev.filter(v => v.id !== versionId))
    } finally {
      setDeletingId(null)
    }
  }, [task.id])

  const handleViewDiff = useCallback(async (v: ArticleVersion) => {
    setDiffLoading(v.id)
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}/versions/${v.id}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setDiffView({ version: v, content: data.content })
    } finally {
      setDiffLoading(null)
    }
  }, [task.id])

  useEffect(() => {
    if (versionsOpen && isReviewable) fetchVersions()
  }, [versionsOpen, isReviewable, fetchVersions])

  // ── Apply AI response to article ────────────────────────────────────────────
  const handleApplyToArticle = useCallback(async (originalText: string, newText: string, label = "AI 辅助应用") => {
    const beforeContent = editableContent          // snapshot BEFORE change
    const updated = beforeContent.replace(originalText, newText)
    if (updated === beforeContent) return          // text not found, nothing to do
    setEditableContent(updated)
    setHasUnsaved(false)
    try {
      // 1. Create version with content BEFORE the change (so diff shows what changed)
      await fetch(`/api/v1/tasks/${task.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ label, content: beforeContent }),
      })
      // 2. Save new content to DB
      const saveRes = await fetch(`/api/v1/tasks/${task.id}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ content: updated }),
      })
      if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`)
      lastSavedContentRef.current = updated
      queryClient.invalidateQueries({ queryKey: ["task", task.id] })
      await fetchVersions()
    } catch (err) {
      console.error(err)
    }
  }, [editableContent, task.id, fetchVersions, queryClient])

  const handleSaveContent = useCallback(async () => {
    if (editableContent === lastSavedContentRef.current) return  // nothing changed
    setIsSaving(true)
    try {
      const beforeContent = lastSavedContentRef.current
      // 1. Create version with content BEFORE this edit session
      await fetch(`/api/v1/tasks/${task.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ label: "手动编辑", content: beforeContent }),
      })
      // 2. Save new content to DB
      const res = await fetch(`/api/v1/tasks/${task.id}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ content: editableContent }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      lastSavedContentRef.current = editableContent
      queryClient.invalidateQueries({ queryKey: ["task", task.id] })
      await fetchVersions()
      setHasUnsaved(false)
    } catch (err) {
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }, [task.id, editableContent, fetchVersions, queryClient])

  // ── Text selection floating toolbar ─────────────────────────────────────────
  useEffect(() => {
    if (!isReviewable) return

    const handleMouseUp = (e: MouseEvent) => {
      // If the click came from inside the floating toolbar itself, do nothing
      if (floatingBarRef.current?.contains(e.target as Node)) return

      // Textarea: window.getSelection() doesn't cover it; use selectionStart/End
      const target = e.target as HTMLElement
      if (target.tagName === "TEXTAREA") {
        const ta = target as HTMLTextAreaElement
        const selected = ta.value.substring(ta.selectionStart, ta.selectionEnd).trim()
        if (selected) {
          setFloatingBar({ x: e.clientX, y: e.clientY - 52, text: selected })
        } else {
          setFloatingBar(null)
        }
        return
      }

      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setFloatingBar(null)
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setFloatingBar({
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY - 48,
        text: sel.toString().trim(),
      })
    }

    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [isReviewable])

  // ── Approve / download ───────────────────────────────────────────────────────
  const handleApprove = async () => {
    setIsApproving(true)
    try {
      await tasksApi.control(task.id, "approve")
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["task", task.id] })
      setShowApproveDialog(false)
      router.push("/dashboard")
    } catch (err) {
      console.error(err)
    } finally {
      setIsApproving(false)
    }
  }

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const resp = await tasksApi.exportDocx(task.id)
      if (!resp.ok) throw new Error("导出失败")
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${task.title}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDownloading(false)
    }
  }

  const displayContent = () => {
    if (activeSegment) {
      return task.segments.find((s) => s.segment_type === activeSegment)?.content ?? ""
    }
    return isReviewable ? editableContent : (task.content ?? "")
  }

  return (
    <div
      className={cn(
        "flex h-[calc(100vh-4rem)] flex-col",
        isReviewable &&
          "bg-gradient-to-br from-amber-50/35 via-background to-background"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-b px-6 py-4",
          isReviewable
            ? "border-slate-200/90 bg-white/90 backdrop-blur-sm"
            : "border-border bg-card"
        )}
      >
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{task.title}</h1>
              <Badge className={cn("shrink-0", status.color)}>{status.label}</Badge>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {new Date(task.created_at).toLocaleDateString("zh-CN")}
              </span>
              {task.word_count ? (
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {task.word_count.toLocaleString()} 字
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {isReviewable && hasUnsaved && (
            <Button variant="outline" onClick={handleSaveContent} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              保存修改
            </Button>
          )}
          {isReviewable && (
            <Button variant="outline" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              导出 Word
            </Button>
          )}
          {task.status === "review" && (
            <Button onClick={() => setShowApproveDialog(true)}>
              <CheckCircle className="mr-2 h-4 w-4" />
              审核通过
            </Button>
          )}
          {isReviewable && (
            <Button
              variant={versionsOpen ? "secondary" : "outline"}
              onClick={() => { setVersionsOpen(o => !o); setChatOpen(false) }}
              className="gap-2"
            >
              <History className="h-4 w-4" />
              历史版本
            </Button>
          )}
          {isReviewable && (
            <Button
              variant={chatOpen ? "secondary" : "outline"}
              onClick={() => {
                setChatOpen(o => !o)
                setVersionsOpen(false)
              }}
              className="gap-2 rounded-full"
            >
              <Bot className="h-4 w-4" />
              AI 改稿
            </Button>
          )}
        </div>
      </div>

      {isReviewable && activeSegment && (
        <div className="border-b border-sky-100 bg-gradient-to-r from-sky-50/90 to-white px-6 py-2.5 text-[13px] text-sky-950">
          <span className="font-medium">本章预览：</span>
          {segmentLabels[activeSegment] ?? activeSegment}
          <span className="ml-2 text-sky-800/85">
            打开「AI 改稿」时，会将本章正文一并提供给模型，便于按章修改。
          </span>
        </div>
      )}

      {task.warning_msg && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-700">
          {task.warning_msg}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-52 shrink-0 border-r border-border bg-muted/30 overflow-y-auto">
          <div className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Layers className="h-4 w-4 text-primary" />
              {isWriting ? "生成进度" : "内容结构"}
            </h2>
          </div>

          {isWriting ? (
            // Stage progress panel
            <nav className="space-y-1 p-3">
              {STAGES.map(stage => {
                const st: StageStatus = stages[stage.key] ?? "waiting"
                return (
                  <div key={stage.key} className="flex items-center gap-2 rounded-lg px-3 py-2">
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-xs", {
                      "bg-muted text-muted-foreground": st === "waiting",
                      "bg-primary/10 text-primary": st === "writing",
                      "bg-emerald-500/10 text-emerald-600": st === "done",
                      "bg-destructive/10 text-destructive": st === "failed",
                    })}>
                      {st === "writing" ? <Loader2 className="h-3 w-3 animate-spin" /> :
                       st === "done" ? <CheckCircle className="h-3 w-3" /> :
                       st === "failed" ? <XCircle className="h-3 w-3" /> :
                       <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    <span className={cn("text-sm", {
                      "text-muted-foreground": st === "waiting",
                      "text-primary font-medium": st === "writing",
                      "text-foreground": st === "done",
                      "text-destructive": st === "failed",
                    })}>
                      {stage.label}
                    </span>
                  </div>
                )
              })}
            </nav>
          ) : (
            // Segment navigator
            <nav className="space-y-1 p-3">
              <button
                onClick={() => setActiveSegment(null)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  !activeSegment ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                完整文章
              </button>
              {task.segments.map(seg => (
                <button
                  key={seg.id}
                  onClick={() => setActiveSegment(seg.segment_type)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    activeSegment === seg.segment_type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <div>{segmentLabels[seg.segment_type] ?? seg.title}</div>
                  <div className="mt-0.5 text-xs opacity-70">{seg.word_count} 字</div>
                </button>
              ))}
            </nav>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {isWriting ? (
              // Live token stream view
              <div className="mx-auto max-w-3xl">
                {completedSegments.map((seg, i) => (
                  <div key={i} className="mb-6">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                      {segmentLabels[seg.type] ?? seg.type}
                    </div>
                    <pre className="whitespace-pre-wrap font-serif text-base leading-8 text-foreground opacity-70">
                      {seg.content}
                    </pre>
                  </div>
                ))}
                {liveBuffer && (
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在生成…
                    </div>
                    <pre className="whitespace-pre-wrap font-serif text-base leading-8 text-foreground">
                      {liveBuffer}
                      <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-primary" />
                    </pre>
                  </div>
                )}
                {!liveBuffer && completedSegments.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm">AI 正在生成内容，请稍候…</p>
                  </div>
                )}
              </div>
            ) : task.status === "failed" ? (
              <div className="mx-auto max-w-2xl rounded-2xl border border-red-200 bg-red-50/90 px-6 py-10 text-center shadow-sm">
                <XCircle className="mx-auto mb-4 h-10 w-10 text-red-600" />
                <p className="text-sm font-semibold text-red-950">任务失败</p>
                <pre className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-red-100 bg-white p-4 text-left font-mono text-xs leading-relaxed text-red-900">
                  {task.error_msg ?? "任务执行失败（未返回详细原因）。请查看 Celery/worker 控制台日志。"}
                </pre>
              </div>
            ) : (
              isReviewable && !activeSegment ? (
                <textarea
                  className="w-full resize-none whitespace-pre-wrap font-serif text-base leading-8 text-foreground bg-transparent outline-none"
                  style={{ minHeight: 'calc(100vh - 10rem)' }}
                  value={editableContent}
                  onChange={e => { setEditableContent(e.target.value); setHasUnsaved(true) }}
                  spellCheck={false}
                />
              ) : (
                <pre className="whitespace-pre-wrap font-serif text-base leading-8 text-foreground">
                  {displayContent() || "（暂无内容）"}
                </pre>
              )
            )}
          </div>
        </div>

        {isReviewable && versionsOpen && (
          <div className="flex w-[22rem] shrink-0 flex-col border-l border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <History className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">历史版本</span>
              <span className="ml-auto text-xs text-muted-foreground">最多 50 条</span>
            </div>

            <ScrollArea className="flex-1">
              {versionsLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : versions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                  <History className="h-8 w-8 opacity-25" />
                  <p className="text-xs">暂无历史版本</p>
                  <p className="text-xs opacity-60">应用 AI 修改或手动保存时自动记录</p>
                </div>
              ) : (
                <div className="space-y-2 p-3">
                  {versions.map((v) => {
                    const date = new Date(v.created_at)
                    const dateStr = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
                    const timeStr = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
                    return (
                      <div key={v.id} className="group rounded-lg border border-border bg-card px-3 py-2.5 transition-all hover:border-primary/40 hover:bg-muted/30">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                            v.label === "AI 辅助应用" && "bg-primary/10 text-primary",
                            v.label === "手动替换"    && "bg-violet-500/10 text-violet-600",
                            v.label === "手动编辑"    && "bg-amber-500/10 text-amber-600",
                            v.label === "恢复前快照"  && "bg-muted text-muted-foreground",
                            !["AI 辅助应用","手动替换","手动编辑","恢复前快照"].includes(v.label) && "bg-muted text-muted-foreground"
                          )}>
                            {v.label}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{dateStr} {timeStr}</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {v.preview || "（空内容）"}
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">{v.word_count.toLocaleString()} 字</span>
                          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                              disabled={diffLoading === v.id || !!restoringId || !!deletingId}
                              onClick={() => handleViewDiff(v)}
                            >
                              {diffLoading === v.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <GitCompare className="h-3 w-3" />}
                              对比
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-xs text-primary hover:text-primary"
                              disabled={restoringId === v.id || !!deletingId || !!diffLoading}
                              onClick={() => setRestoreConfirm(v)}
                            >
                              {restoringId === v.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <RotateCw className="h-3 w-3" />}
                              恢复
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                              disabled={deletingId === v.id || !!restoringId}
                              onClick={() => setDeleteConfirm(v)}
                            >
                              {deletingId === v.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Trash2 className="h-3 w-3" />}
                              删除
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

      {/* AI 改稿 — 与「AI 对话」一致的会话布局 */}
      {isReviewable && (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent
            side="right"
            className={cn(
              "flex w-[min(100vw,440px)] flex-col gap-0 border-l border-slate-200/80 bg-page-cream p-0 shadow-xl sm:max-w-[440px]"
            )}
          >
            <SheetHeader className="shrink-0 space-y-0 border-b border-amber-200/45 bg-page-cream px-4 py-3 text-left">
              <div className="flex items-start gap-3 pr-8">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base font-semibold text-slate-900">AI 改稿</SheetTitle>
                  <p className="mt-1 text-[12px] font-normal leading-snug text-slate-500">
                    {activeSegment ? (
                      <>已附带「{segmentLabels[activeSegment] ?? activeSegment}」作上下文，直接说想怎么改即可。</>
                    ) : (
                      <>可描述全文修改；或选中段落用浮窗「润色 / 扩写」。</>
                    )}
                  </p>
                </div>
              </div>
            </SheetHeader>

            {hasInstructionBlock && (
              <details className="shrink-0 border-b border-slate-200/50 bg-white/50 px-4 py-2 text-left">
                <summary className="cursor-pointer list-none text-xs font-medium text-slate-600 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-slate-400">▸</span>
                    创建任务时的指令（已保存）
                  </span>
                </summary>
                <div className="mt-2 max-h-32 space-y-2 overflow-y-auto text-[11px] leading-relaxed text-slate-600">
                  {instructionDocText ? (
                    <div>
                      <p className="font-medium text-slate-800">
                        基础指令文档
                        {instructionDocFilename ? ` · ${instructionDocFilename}` : ""}
                      </p>
                      <div className="mt-0.5 max-h-20 overflow-y-auto whitespace-pre-wrap">{instructionDocText}</div>
                    </div>
                  ) : null}
                  {batchPrompt ? (
                    <div>
                      <p className="font-medium text-slate-800">补充提示</p>
                      <div className="whitespace-pre-wrap">{batchPrompt}</div>
                    </div>
                  ) : null}
                  {targetWordsDisplay !== null ? (
                    <p>
                      <span className="font-medium text-slate-800">目标总字数：</span>
                      约 {targetWordsDisplay.toLocaleString()} 字
                    </p>
                  ) : (
                    <p>
                      <span className="font-medium text-slate-800">目标总字数：</span>
                      未单独填写，使用系统默认约 18,000 字
                    </p>
                  )}
                </div>
              </details>
            )}

            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto max-w-full px-4 pb-6 pt-5">
                {chatMessages.length === 0 ? (
                  <div className="flex min-h-[min(42vh,320px)] flex-col items-center justify-center gap-4 px-2 text-center">
                    <Bot className="h-14 w-14 text-amber-200/90" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">像对话一样改稿</p>
                      <p className="max-w-[260px] text-xs leading-relaxed text-slate-500">
                        在文中选中后可快捷润色；或在下方输入指令，模型会结合正文上下文回复。
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {["收紧叙事节奏", "加强对话张力", "全文检查错别字"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="rounded-full border border-slate-200/90 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:border-amber-300/80 hover:bg-amber-50/50"
                          onClick={() => setChatInput((prev) => (prev ? `${prev}，${t}` : t))}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className="group/msg">
                        {msg.role === "user" ? (
                          <div className="flex justify-end gap-3">
                            <div className="max-w-[min(100%,22rem)] rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-slate-200/80">
                              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                                {msg.content}
                              </p>
                            </div>
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200/80">
                              <User className="h-4 w-4 text-slate-600" />
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
                              <Bot className="h-4 w-4 text-amber-800" />
                            </div>
                            <div className="min-w-0 flex-1 max-w-[min(100%,calc(100%-2.5rem))]">
                              <div className="rounded-2xl border border-slate-100/90 bg-white px-4 py-3 text-left shadow-sm">
                                <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                                  {msg.content}
                                  {msg.streaming &&
                                    (msg.content ? (
                                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-amber-500" />
                                    ) : (
                                      <span className="mt-2 flex gap-1">
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-400" />
                                        <span
                                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-400"
                                          style={{ animationDelay: "160ms" }}
                                        />
                                        <span
                                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-400"
                                          style={{ animationDelay: "320ms" }}
                                        />
                                      </span>
                                    ))}
                                </div>
                              </div>
                              {msg.role === "assistant" &&
                                msg.isActionResponse &&
                                !msg.streaming &&
                                msg.content &&
                                msg.selectedTextRef && (
                                  <button
                                    type="button"
                                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200/90 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100/90"
                                    onClick={() =>
                                      handleApplyToArticle(msg.selectedTextRef!, msg.content)
                                    }
                                  >
                                    <Replace className="h-3.5 w-3.5" />
                                    应用到文章
                                  </button>
                                )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={chatMessagesEndRef} />
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="pointer-events-none shrink-0 border-t border-slate-200/70 bg-gradient-to-t from-page-cream via-page-cream to-transparent pb-4 pt-10">
              <div className="pointer-events-auto px-3">
                <div className="rounded-2xl border border-slate-200/90 bg-white p-2 shadow-lg shadow-slate-900/[0.06]">
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          if (!chatSending && chatInput.trim()) {
                            sendReviewChat(chatInput)
                            setChatInput("")
                          }
                        }
                      }}
                      placeholder="输入修改指令，Shift+Enter 换行…"
                      className="max-h-36 min-h-[48px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-[15px] shadow-none placeholder:text-slate-400 focus-visible:ring-0"
                      rows={2}
                      disabled={chatSending}
                    />
                    <Button
                      size="icon"
                      className="mb-0.5 h-11 w-11 shrink-0 rounded-xl bg-slate-900 hover:bg-slate-800"
                      disabled={!chatInput.trim() || chatSending}
                      onClick={() => {
                        sendReviewChat(chatInput)
                        setChatInput("")
                      }}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-center text-[10px] text-slate-400">
                  AI 生成仅供参考，应用前请核对事实与措辞
                </p>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Floating text selection toolbar */}
      {floatingBar && isReviewable && (
        <div
          ref={floatingBarRef}
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 shadow-lg"
          style={{ left: floatingBar.x - 80, top: floatingBar.y }}
          onMouseDown={e => e.preventDefault()}
        >
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-secondary transition-colors"
            onClick={() => {
              const text = floatingBar.text
              setChatOpen(true)
              sendReviewChat("", text, "polish")
              setFloatingBar(null)
            }}
          >
            <Sparkles className="h-3 w-3 text-primary" />
            润色
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-secondary transition-colors"
            onClick={() => {
              const text = floatingBar.text
              setChatOpen(true)
              sendReviewChat("", text, "expand")
              setFloatingBar(null)
            }}
          >
            <Maximize2 className="h-3 w-3 text-primary" />
            扩写
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-secondary transition-colors"
            onClick={() => {
              const text = floatingBar.text
              setChatOpen(true)
              sendReviewChat("", text, "rewrite")
              setFloatingBar(null)
            }}
          >
            <RotateCcw className="h-3 w-3 text-primary" />
            重写
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-secondary transition-colors"
            onClick={() => {
              const text = floatingBar.text
              setManualReplaceBar({ text, replaceTo: "" })
              setFloatingBar(null)
            }}
          >
            <Edit3 className="h-3 w-3 text-primary" />
            手动替换
          </button>
        </div>
      )}

      {/* Manual replace dialog */}
      {manualReplaceBar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="mb-1 text-sm font-semibold">手动替换</h3>
            <p className="mb-3 text-xs text-muted-foreground line-clamp-2">
              原文：{manualReplaceBar.text}
            </p>
            <Textarea
              autoFocus
              placeholder="输入替换内容…"
              value={manualReplaceBar.replaceTo}
              onChange={e => setManualReplaceBar(prev => prev ? { ...prev, replaceTo: e.target.value } : null)}
              className="min-h-[100px] resize-none text-sm"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setManualReplaceBar(null)}>取消</Button>
              <Button
                size="sm"
                disabled={!manualReplaceBar.replaceTo.trim()}
                onClick={() => {
                  handleApplyToArticle(manualReplaceBar.text, manualReplaceBar.replaceTo, "手动替换")
                  setManualReplaceBar(null)
                }}
              >
                <Replace className="mr-1.5 h-3.5 w-3.5" />
                替换
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Diff view dialog */}
      {diffView && (() => {
        const parts = diffWords(diffView.content, editableContent)
        const date = new Date(diffView.version.created_at)
        const dateStr = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
        const timeStr = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        const addedCount = parts.filter(p => p.added).reduce((n, p) => n + p.value.length, 0)
        const removedCount = parts.filter(p => p.removed).reduce((n, p) => n + p.value.length, 0)
        const leftParts = parts.filter(p => !p.added)
        const rightParts = parts.filter(p => !p.removed)
        return (
          <Dialog open onOpenChange={() => setDiffView(null)}>
            {/* sm:max-w-[92vw] 覆盖 dialog.tsx 里内置的 sm:max-w-lg */}
            <DialogContent className="sm:max-w-[92vw] w-[92vw] h-[88vh] p-0 gap-0 overflow-hidden flex flex-col rounded-xl">

              {/* ── 顶栏 ── */}
              <div className="shrink-0 flex items-center gap-3 border-b border-border px-6 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                  <GitCompare className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">版本对比</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {diffView.version.label} · {dateStr} {timeStr}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2 pr-8">
                  <span className="flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                    +{addedCount} 新增
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 ring-1 ring-red-200">
                    −{removedCount} 删除
                  </span>
                </div>
              </div>

              {/* ── 双栏内容 ── */}
              <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* 左栏：历史版本 */}
                <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
                  <div className="shrink-0 flex items-center gap-2 border-b border-red-100 bg-red-50/60 px-6 py-2">
                    <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                    <span className="text-[11px] font-medium text-red-600">历史版本</span>
                    <span className="ml-auto text-[11px] text-red-400">{diffView.version.word_count.toLocaleString()} 字</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-8 py-6">
                    <p className="font-serif text-[13.5px] leading-[2.1] whitespace-pre-wrap text-foreground">
                      {leftParts.map((part, i) =>
                        part.removed ? (
                          <span key={i} className="rounded bg-red-100 px-0.5 text-red-700 line-through decoration-red-400/60">
                            {part.value}
                          </span>
                        ) : (
                          <span key={i}>{part.value}</span>
                        )
                      )}
                    </p>
                  </div>
                </div>

                {/* 右栏：当前内容 */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="shrink-0 flex items-center gap-2 border-b border-emerald-100 bg-emerald-50/60 px-6 py-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-[11px] font-medium text-emerald-700">当前内容</span>
                    <span className="ml-auto text-[11px] text-emerald-500">{editableContent.length.toLocaleString()} 字</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-8 py-6">
                    <p className="font-serif text-[13.5px] leading-[2.1] whitespace-pre-wrap text-foreground">
                      {rightParts.map((part, i) =>
                        part.added ? (
                          <span key={i} className="rounded bg-emerald-100 px-0.5 text-emerald-800">
                            {part.value}
                          </span>
                        ) : (
                          <span key={i}>{part.value}</span>
                        )
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* ── 底栏 ── */}
              <div className="shrink-0 flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-6 py-3">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => setDiffView(null)}>
                  关闭
                </Button>
                <Button size="sm" onClick={() => { setRestoreConfirm(diffView.version); setDiffView(null) }}>
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                  恢复此版本
                </Button>
              </div>

            </DialogContent>
          </Dialog>
        )
      })()}

      {/* Restore confirmation dialog */}
      {restoreConfirm && (() => {
        const date = new Date(restoreConfirm.created_at)
        const dateStr = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
        const timeStr = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        return (
          <Dialog open onOpenChange={() => setRestoreConfirm(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <RotateCw className="h-4 w-4 text-primary" />
                  确认恢复版本
                </DialogTitle>
                <DialogDescription className="space-y-3 pt-1 text-left text-sm leading-relaxed">
                  <p>
                    即将恢复至&nbsp;
                    <span className="font-medium text-foreground">{restoreConfirm.label}</span>
                    &nbsp;（{dateStr} {timeStr}，{restoreConfirm.word_count.toLocaleString()} 字）。
                  </p>
                  <p className="text-amber-600">
                    该版本之后的所有修改将被全部覆盖，包括其他段落的改动。
                  </p>
                  <p className="text-muted-foreground text-xs">
                    当前内容会自动保存为「恢复前快照」，如果恢复后反悔可以再次还原。
                  </p>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRestoreConfirm(null)}>取消</Button>
                <Button
                  disabled={restoringId === restoreConfirm.id}
                  onClick={() => { handleRestoreVersion(restoreConfirm.id); setRestoreConfirm(null) }}
                >
                  {restoringId === restoreConfirm.id
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <RotateCw className="mr-2 h-4 w-4" />}
                  确认恢复
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* Delete version confirmation dialog */}
      {deleteConfirm && (() => {
        const date = new Date(deleteConfirm.created_at)
        const dateStr = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
        const timeStr = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        return (
          <Dialog open onOpenChange={() => setDeleteConfirm(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-destructive" />
                  删除历史版本
                </DialogTitle>
                <DialogDescription className="space-y-2 pt-1 text-left text-sm leading-relaxed">
                  <p>
                    确定要删除&nbsp;
                    <span className="font-medium text-foreground">{deleteConfirm.label}</span>
                    &nbsp;（{dateStr} {timeStr}）吗？
                  </p>
                  <p className="text-destructive">
                    删除后无法恢复，该版本的内容将永久丢失。
                  </p>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteConfirm(null)}>取消</Button>
                <Button
                  variant="destructive"
                  disabled={deletingId === deleteConfirm.id}
                  onClick={() => { handleDeleteVersion(deleteConfirm.id); setDeleteConfirm(null) }}
                >
                  {deletingId === deleteConfirm.id
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Trash2 className="mr-2 h-4 w-4" />}
                  确认删除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* Approve dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认审核通过</DialogTitle>
            <DialogDescription>
              审核通过后，该文章将标记为已通过状态。确定要通过审核吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>取消</Button>
            <Button onClick={handleApprove} disabled={isApproving}>
              {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              确认通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
