"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Users, FileText, CheckCircle, Clock, Loader2, Activity, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { adminApi, type AdminDashboardStats } from "@/lib/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const statusLabel: Record<string, string> = {
  queued: "排队中",
  writing: "生成中",
  plan_review: "待审规划",
  paused: "已暂停",
  review: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  cancelled: "已取消",
  failed: "失败",
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    adminApi
      .getStats()
      .then(setStats)
      .catch((e: Error) => setLoadError(e.message || "加载失败"))
  }, [])

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载统计数据…
      </div>
    )
  }

  const review = stats.tasks_by_status.review ?? 0
  const approved = stats.tasks_by_status.approved ?? 0
  const failed = stats.tasks_by_status.failed ?? 0

  const cards = [
    { title: "总用户数", value: stats.users_total, desc: `${stats.users_active} 个活跃`, icon: Users, color: "text-primary" },
    { title: "总任务数", value: stats.tasks_total, desc: "全站所有用户", icon: FileText, color: "text-muted-foreground" },
    { title: "执行中", value: stats.tasks_running, desc: "排队 + 生成中", icon: Activity, color: "text-sky-600" },
    { title: "待审核", value: review, desc: "生成完成待用户审核", icon: Clock, color: "text-amber-600" },
    { title: "已通过", value: approved, desc: "审核通过", icon: CheckCircle, color: "text-emerald-600" },
    { title: "失败", value: failed, desc: "执行失败的任务", icon: AlertCircle, color: "text-destructive" },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">管理仪表盘</h1>
        <p className="text-sm text-muted-foreground">系统概览与最近任务（全站）</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground">{card.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">最近任务</h2>
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-48">用户</TableHead>
                <TableHead className="w-28">状态</TableHead>
                <TableHead className="w-20 text-right">进度</TableHead>
                <TableHead className="w-36">更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.recent_tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    暂无任务
                  </TableCell>
                </TableRow>
              ) : (
                stats.recent_tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/article/${t.id}`}
                        className="line-clamp-2 text-sm text-primary hover:underline"
                      >
                        {t.title}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">{t.user_email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs font-normal">
                        {statusLabel[t.status] ?? t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {(t.status === "writing" || t.status === "queued") ? `${t.progress}%` : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(t.updated_at).toLocaleString("zh-CN")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
