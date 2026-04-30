"use client"

import Link from "next/link"
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
} from "lucide-react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { TaskListItem, TaskStatus } from "@/lib/types"

interface TaskCardProps {
  task: TaskListItem
}

const statusConfig: Record<
  TaskStatus,
  { label: string; color: string; icon: React.ElementType; description: string }
> = {
  queued:      { label: "排队中",   color: "bg-muted text-muted-foreground",         icon: Clock,          description: "任务已加入队列，等待执行..." },
  writing:     { label: "生成中",   color: "bg-primary/10 text-primary",             icon: Loader2,        description: "AI 正在生成文章..." },
  plan_review: { label: "待审规划", color: "bg-violet-500/10 text-violet-600",       icon: ClipboardCheck, description: "规划已生成，等待您审核确认" },
  paused:      { label: "已暂停",   color: "bg-amber-500/10 text-amber-600",         icon: Pause,          description: "任务已暂停，可以继续执行" },
  review:      { label: "待审核",   color: "bg-amber-500/10 text-amber-600",         icon: CheckCheck,     description: "文章已生成，点击进入审核" },
  approved:    { label: "已通过",   color: "bg-emerald-500/10 text-emerald-600",     icon: CheckCircle,    description: "文章已审核通过" },
  rejected:    { label: "已拒绝",   color: "bg-destructive/10 text-destructive",     icon: XCircle,        description: "文章已被退回" },
  cancelled:   { label: "已取消",   color: "bg-muted text-muted-foreground",         icon: XCircle,        description: "任务已取消" },
  failed:      { label: "失败",     color: "bg-destructive/10 text-destructive",     icon: AlertCircle,    description: "任务执行失败" },
}

export function TaskCard({ task }: TaskCardProps) {
  const cfg = statusConfig[task.status] ?? statusConfig.failed
  const StatusIcon = cfg.icon
  const formattedDate = new Date(task.created_at).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  // Determine if card is clickable and where it links
  const isClickable = ["review", "approved", "rejected"].includes(task.status)
  const isPlanReview = task.status === "plan_review"
  const href = isPlanReview
    ? `/dashboard/article/${task.id}/plan`
    : `/dashboard/article/${task.id}`

  const cardContent = (
    <Card
      className={cn(
        "group transition-all duration-200",
        (isClickable || isPlanReview) && "cursor-pointer hover:border-primary/50 hover:shadow-md"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-base font-semibold text-foreground group-hover:text-primary transition-colors">
            {task.title}
          </h3>
          <Badge variant="secondary" className={cn("shrink-0", cfg.color)}>
            <StatusIcon className={cn("mr-1 h-3 w-3", task.status === "writing" && "animate-spin")} />
            {cfg.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <p className="text-sm text-muted-foreground">
          {task.error_msg ? `错误：${task.error_msg}` : cfg.description}
        </p>
        {task.warning_msg && (
          <p className="mt-1 text-xs text-amber-600">{task.warning_msg}</p>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {task.word_count ? (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {task.word_count.toLocaleString()} 字
            </span>
          ) : null}
          <span>{formattedDate}</span>
        </div>
        {task.status === "writing" && (
          <div className="flex items-center gap-2">
            <Progress value={task.progress} className="h-1.5 w-16" />
            <span className="text-xs text-muted-foreground">{task.progress}%</span>
          </div>
        )}
      </CardFooter>
    </Card>
  )

  if (isClickable || isPlanReview) {
    return <Link href={href}>{cardContent}</Link>
  }

  return cardContent
}
