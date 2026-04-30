"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  CheckCircle,
  Download,
  FileText,
  Clock,
  Loader2,
  Layers,
  XCircle,
  RefreshCw,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
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
  intro:   "引子",
  free:    "免费部分",
  paywall: "卡点",
  paid:    "付费部分",
}

export function ArticleEditor({ task }: ArticleEditorProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showApproveDialog, setShowApproveDialog] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [activeSegment, setActiveSegment] = useState<string | null>(null)

  const status = statusConfig[task.status] ?? statusConfig.failed

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

  // Show the content of the selected/active segment, or the full assembled content
  const displayContent = () => {
    if (activeSegment) {
      const seg = task.segments.find((s) => s.segment_type === activeSegment)
      return seg?.content ?? ""
    }
    return task.content ?? ""
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
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

        {/* Actions */}
        <div className="flex gap-2">
          {(task.status === "review" || task.status === "approved") && (
            <Button variant="outline" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              导出 Word
            </Button>
          )}
          {task.status === "review" && (
            <Button onClick={() => setShowApproveDialog(true)}>
              <CheckCircle className="mr-2 h-4 w-4" />
              审核通过
            </Button>
          )}
        </div>
      </div>

      {/* Warning message */}
      {task.warning_msg && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-700">
          {task.warning_msg}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar – segment navigator */}
        <div className="w-56 shrink-0 border-r border-border bg-muted/30">
          <div className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-foreground text-sm">
              <Layers className="h-4 w-4 text-primary" />
              内容结构
            </h2>
          </div>
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveSegment(null)}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors",
                !activeSegment
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              完整文章
            </button>
            {task.segments.map((seg) => (
              <button
                key={seg.id}
                onClick={() => setActiveSegment(seg.segment_type)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors",
                  activeSegment === seg.segment_type
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <div>{segmentLabels[seg.segment_type] ?? seg.title}</div>
                <div className="text-xs opacity-70 mt-0.5">{seg.word_count} 字</div>
              </button>
            ))}
          </nav>
        </div>

        {/* Main content area */}
        <ScrollArea className="flex-1">
          <div className="p-6">
            {task.status === "writing" || task.status === "queued" ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
                <p className="text-sm">AI 正在生成内容，请稍候…</p>
              </div>
            ) : task.status === "failed" ? (
              <div className="flex flex-col items-center justify-center py-20 text-destructive">
                <XCircle className="h-8 w-8 mb-4" />
                <p className="text-sm">{task.error_msg ?? "任务执行失败"}</p>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-serif text-base leading-8 text-foreground">
                {displayContent() || "（暂无内容）"}
              </pre>
            )}
          </div>
        </ScrollArea>
      </div>

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
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              取消
            </Button>
            <Button onClick={handleApprove} disabled={isApproving}>
              {isApproving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              确认通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
