"use client"

import Link from "next/link"
import { Clock, FileText, CheckCircle, XCircle, Loader2, CheckCheck } from "lucide-react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { WritingTask, TaskStatus } from "@/lib/types"

interface TaskCardProps {
  task: WritingTask
}

const statusConfig: Record<TaskStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: "等待执行", color: "bg-muted text-muted-foreground", icon: Clock },
  processing: { label: "执行中", color: "bg-primary/10 text-primary", icon: Loader2 },
  completed: { label: "待审核", color: "bg-amber-500/10 text-amber-600", icon: CheckCheck },
  approved: { label: "已通过", color: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle },
  rejected: { label: "已拒绝", color: "bg-destructive/10 text-destructive", icon: XCircle },
}

export function TaskCard({ task }: TaskCardProps) {
  const status = statusConfig[task.status]
  const StatusIcon = status.icon
  const formattedDate = new Date(task.createdAt).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  // 只有已完成（待审核）、已通过、已拒绝的任务可以点击查看
  const isClickable = task.status === "completed" || task.status === "approved" || task.status === "rejected"

  const cardContent = (
    <Card
      className={cn(
        "group transition-all duration-200",
        isClickable && "cursor-pointer hover:border-primary/50 hover:shadow-md"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-base font-semibold text-foreground group-hover:text-primary transition-colors">
            {task.title}
          </h3>
          <Badge variant="secondary" className={cn("shrink-0", status.color)}>
            <StatusIcon className={cn("mr-1 h-3 w-3", task.status === "processing" && "animate-spin")} />
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {task.status === "pending" && (
          <p className="text-sm text-muted-foreground">任务已加入队列，等待执行...</p>
        )}
        {task.status === "processing" && (
          <p className="text-sm text-muted-foreground">AI正在生成文章内容...</p>
        )}
        {task.status === "completed" && (
          <p className="text-sm text-muted-foreground">文章已生成，点击进入审核</p>
        )}
        {task.status === "approved" && (
          <p className="text-sm text-muted-foreground">文章已审核通过</p>
        )}
        {task.status === "rejected" && (
          <p className="text-sm text-muted-foreground">文章已被退回，点击查看详情</p>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {task.wordCount && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {task.wordCount}字
            </span>
          )}
          <span>{formattedDate}</span>
        </div>
        {task.status === "processing" && (
          <div className="flex items-center gap-2">
            <Progress value={task.progress} className="h-1.5 w-16" />
            <span className="text-xs text-muted-foreground">{task.progress}%</span>
          </div>
        )}
      </CardFooter>
    </Card>
  )

  if (isClickable) {
    return <Link href={`/dashboard/article/${task.id}`}>{cardContent}</Link>
  }

  return cardContent
}
