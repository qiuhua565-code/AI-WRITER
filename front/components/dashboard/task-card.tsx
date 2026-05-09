"use client"

import { useState } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import {
  Clock,
  FileText,
  CheckCircle,
  XCircle,
  Loader2,
  CheckCheck,
  Pause,
  AlertCircle,
  ClipboardCheck,
  RotateCcw,
  Trash2,
  StopCircle,
  ScrollText,
  ExternalLink,
  ChevronDown,
  Copy,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskListItem, TaskStatus } from "@/lib/types"
import { tasksApi } from "@/lib/api"

interface TaskCardProps {
  task: TaskListItem
}

/** 列表卡片用简短说明，避免整屏英文堆栈 */
function friendlyFailureHint(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes("timed out") || s.includes("timeout"))
    return "请求超时，多为网络不稳定或上游响应过久，可稍后重试。"
  if (s.includes("429") || s.includes("too many requests") || s.includes("rate limit"))
    return "接口限流（429），请稍后再试或减少并发任务。"
  if (s.includes("interrupted") || s.includes("cancelled"))
    return "请求被中断；若为主动终止可忽略，否则请重试。"
  if (s.includes("connection") || s.includes("network") || s.includes("连接"))
    return "网络连接异常，请检查网络后重试。"
  if (raw.length > 100 || /https?:\/\//.test(raw))
    return "生成过程中出现异常，可展开查看技术详情或联系管理员。"
  return raw
}

const statusConfig: Record<
  TaskStatus,
  {
    label: string
    strip: string
    dot: string
    icon: React.ElementType
    description: string
  }
> = {
  queued: {
    label: "排队中",
    strip: "bg-sky-500",
    dot: "bg-sky-500",
    icon: Clock,
    description: "任务已加入队列，等待执行...",
  },
  writing: {
    label: "生成中",
    strip: "bg-gradient-to-b from-sky-600 via-sky-500 to-blue-600",
    dot: "bg-sky-500",
    icon: Loader2,
    description: "AI 正在生成文章...",
  },
  plan_review: {
    label: "待审规划",
    strip: "bg-primary",
    dot: "bg-primary/90",
    icon: ClipboardCheck,
    description: "规划已生成，等待您审核确认",
  },
  paused: {
    label: "已暂停",
    strip: "bg-slate-500",
    dot: "bg-slate-500",
    icon: Pause,
    description: "任务已暂停，可以继续执行",
  },
  review: {
    label: "待审核",
    strip: "bg-sky-600",
    dot: "bg-sky-500",
    icon: CheckCheck,
    description: "文章已生成，点击进入审核",
  },
  approved: {
    label: "已通过",
    strip: "bg-emerald-600",
    dot: "bg-emerald-500",
    icon: CheckCircle,
    description: "文章已审核通过",
  },
  rejected: {
    label: "已拒绝",
    strip: "bg-slate-400",
    dot: "bg-slate-400",
    icon: XCircle,
    description: "文章已被退回",
  },
  cancelled: {
    label: "已取消",
    strip: "bg-slate-300",
    dot: "bg-slate-400",
    icon: XCircle,
    description: "任务已取消",
  },
  failed: {
    label: "失败",
    strip: "bg-red-500",
    dot: "bg-red-500",
    icon: AlertCircle,
    description: "任务执行失败",
  },
}

function cardShellClass(status: TaskStatus): string {
  switch (status) {
    case "approved":
      return "ring-2 ring-emerald-400/80 bg-gradient-to-br from-white to-emerald-50/60 shadow-emerald-900/[0.06]"
    case "failed":
      return "ring-2 ring-red-400/90 bg-gradient-to-br from-white to-red-50/70 shadow-red-900/[0.08]"
    case "rejected":
    case "cancelled":
      return "ring-1 ring-slate-200 bg-white"
    case "writing":
    case "queued":
    case "plan_review":
    case "paused":
    case "review":
      return "ring-2 ring-sky-300/90 bg-gradient-to-br from-white to-sky-50/50 shadow-sky-900/[0.05]"
    default:
      return "ring-1 ring-slate-100 bg-white"
  }
}

function badgePillClass(status: TaskStatus): string {
  switch (status) {
    case "approved":
      return "border-0 bg-emerald-100 font-medium text-emerald-900"
    case "failed":
      return "border-0 bg-red-100 font-medium text-red-900"
    case "writing":
      return "border-0 bg-sky-100 font-medium text-sky-900"
    case "queued":
    case "plan_review":
    case "review":
    case "paused":
      return "border-0 bg-sky-50 font-medium text-sky-900 ring-1 ring-sky-200/80"
    default:
      return "border-0 bg-slate-100 font-normal text-slate-700"
  }
}

export function TaskCard({ task }: TaskCardProps) {
  const cfg = statusConfig[task.status] ?? statusConfig.failed
  const StatusIcon = cfg.icon
  const queryClient = useQueryClient()
  const [retrying, setRetrying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [errorDetailOpen, setErrorDetailOpen] = useState(false)

  const formattedDate = new Date(task.created_at).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const handleRetry = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setRetrying(true)
    try {
      await tasksApi.control(task.id, "retry")
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    } finally {
      setRetrying(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    try {
      await tasksApi.delete(task.id)
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    } finally {
      setDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await tasksApi.control(task.id, "cancel")
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    } catch {}
  }

  const canDelete = !["writing", "queued"].includes(task.status)

  const hasInstructionHint =
    (typeof task.config?.batch_prompt === "string" &&
      String(task.config.batch_prompt).trim().length > 0) ||
    (typeof task.config?.instruction_doc_text === "string" &&
      String(task.config.instruction_doc_text).trim().length > 0)

  const isClickable = ["review", "approved", "rejected", "writing", "queued", "paused"].includes(task.status)
  const isPlanReview = task.status === "plan_review"
  const href = isPlanReview
    ? `/dashboard/article/${task.id}/plan`
    : `/dashboard/article/${task.id}`

  const cardContent = (
    <div
      className={cn(
        "group flex overflow-hidden rounded-xl border border-slate-200/80 shadow-sm shadow-slate-900/[0.04] transition-all duration-200",
        cardShellClass(task.status),
        (isClickable || isPlanReview) &&
          "cursor-pointer hover:-translate-y-px hover:shadow-md"
      )}
    >
      <div className={cn("w-1.5 shrink-0 self-stretch", cfg.strip)} aria-hidden />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2 border-b border-slate-100 p-3 pb-2">
          <div className="min-w-0 flex-1">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <h3 className="line-clamp-2 cursor-default text-left text-sm font-semibold leading-snug text-slate-900 group-hover:text-primary">
                  {task.title}
                </h3>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                sideOffset={6}
                className="max-w-[min(90vw,26rem)] px-3 py-2 text-xs font-normal leading-relaxed"
              >
                <span className="block whitespace-pre-wrap break-words">{task.title}</span>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex shrink-0 items-start gap-1.5">
            <div className="flex max-w-[min(100%,9rem)] flex-wrap justify-end gap-1 sm:max-w-none">
              <Badge variant="secondary" className={cn("px-1.5 py-0 text-[10px]", badgePillClass(task.status))}>
                <StatusIcon className={cn("mr-0.5 h-2.5 w-2.5", task.status === "writing" && "animate-spin")} />
                {cfg.label}
              </Badge>
              {hasInstructionHint && (
                <Badge
                  variant="outline"
                  className="border-primary/20 bg-primary/5 px-1 py-0 text-[9px] font-normal text-primary"
                  title="创建时填写了指令"
                >
                  <ScrollText className="mr-0.5 h-2.5 w-2.5" />
                  指令
                </Badge>
              )}
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 text-slate-400 hover:text-red-600"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setShowDeleteDialog(true)
                  }}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
            {(isClickable || isPlanReview) && (
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-primary" aria-hidden />
            )}
          </div>
        </div>

        <div className="px-3 py-2">
          {task.error_msg ? (
            <div className="rounded-lg border border-red-100 bg-red-50/60 px-2.5 py-2 text-xs text-red-900/95">
              <p className="font-medium text-red-950/90">生成未成功</p>
              <p className="mt-1 leading-relaxed text-red-900/90">
                {friendlyFailureHint(task.error_msg)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-red-800/90 underline decoration-red-300 underline-offset-2 hover:text-red-950"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setErrorDetailOpen((o) => !o)
                  }}
                >
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", errorDetailOpen && "rotate-180")}
                  />
                  {errorDetailOpen ? "收起技术信息" : "技术详情（排障用）"}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-red-200/80 bg-white/80 px-2 py-0.5 text-[11px] text-red-800 hover:bg-red-50"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void navigator.clipboard.writeText(task.error_msg ?? "")
                  }}
                >
                  <Copy className="h-3 w-3" />
                  复制
                </button>
              </div>
              {errorDetailOpen && (
                <pre className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-red-100/80 bg-white/90 p-2.5 text-left font-mono text-[10px] leading-relaxed text-red-950/80">
                  {task.error_msg}
                </pre>
              )}
            </div>
          ) : (
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">{cfg.description}</p>
          )}
          {task.warning_msg && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{task.warning_msg}</p>
          )}
        </div>

        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-1.5 border-t px-3 py-2",
            task.status === "failed" && "border-red-100 bg-red-50/50",
            task.status === "approved" && "border-emerald-100 bg-emerald-50/40",
            task.status !== "failed" &&
              task.status !== "approved" &&
              "border-slate-100 bg-slate-50/60"
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dot)} title={cfg.label} />
            <span className="truncate text-slate-600">{cfg.label}</span>
            <span className="text-slate-400">·</span>
            {task.word_count ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <FileText className="h-2.5 w-2.5" />
                {task.word_count.toLocaleString()} 字
              </span>
            ) : null}
            {task.word_count ? <span className="text-slate-400">·</span> : null}
            <span className="shrink-0">{formattedDate}</span>
          </div>
          <div className="flex items-center gap-2">
            {task.status === "writing" && (
              <>
                <Progress value={task.progress ?? 0} className="h-1.5 w-20" />
                <span className="text-xs tabular-nums text-slate-500">{task.progress ?? 0}%</span>
              </>
            )}
            {(task.status === "writing" || task.status === "queued") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-slate-500 hover:text-red-600"
                onClick={handleCancel}
              >
                <StopCircle className="mr-1 h-3 w-3" />
                终止
              </Button>
            )}
            {(task.status === "failed" || task.status === "cancelled") && (
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={handleRetry} disabled={retrying}>
                {retrying ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1 h-3 w-3" />
                )}
                重试
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-fit min-h-0 self-start">
      {isClickable || isPlanReview ? (
        <Link href={href} className="block">
          {cardContent}
        </Link>
      ) : (
        cardContent
      )}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除任务</DialogTitle>
            <DialogDescription>
              确定要删除「{task.title}」吗？删除后无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
