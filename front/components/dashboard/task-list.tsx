"use client"

import { useState } from "react"
import { Search, Filter, Plus } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TaskCard } from "./task-card"
import { TaskListItem, TaskStatus } from "@/lib/types"
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty"

interface TaskListProps {
  tasks: TaskListItem[]
  total: number
}

const statusOptions: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "queued", label: "排队中" },
  { value: "writing", label: "生成中" },
  { value: "plan_review", label: "待审规划" },
  { value: "paused", label: "已暂停" },
  { value: "review", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "cancelled", label: "已取消" },
  { value: "failed", label: "失败" },
]

export function TaskList({ tasks, total }: TaskListProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all")

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === "all" || task.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const pendingReview = tasks.filter((t) => t.status === "review").length

  return (
    <div className="space-y-5">
      {/* 公告条 —— 参考图顶部黄色提示 */}
      <div className="rounded-2xl border border-amber-200/70 bg-amber-50/90 px-4 py-3 text-sm leading-relaxed text-amber-950 shadow-sm ring-1 ring-amber-100/80">
        <span className="font-semibold">提示：</span>
        任务提交后在后台排队生成；可在「任务列表」查看进度，完成后进入文章审核与编辑。
        <span className="mt-1 block text-[13px] text-amber-900/90">
          若多个任务长时间停在「排队中」，通常是<strong>系统写稿 API Key 已被其他任务占用</strong>（每把 Key 同时只跑一篇），不是容器数量不够；可增加「写稿」用途的系统 Key，或为用户绑定「生成」用途的个人 Key。
        </span>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-900/[0.04] ring-1 ring-slate-100 sm:p-7">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-violet-100/50 blur-2xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              我的任务
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              共 {total} 个任务
              {pendingReview > 0 && ` · ${pendingReview} 个待审核`}
            </p>
          </div>
          <Button
            asChild
            size="lg"
            className="shrink-0 rounded-full bg-orange-500 px-6 text-white shadow-md shadow-orange-500/25 hover:bg-orange-600"
          >
            <Link href="/dashboard/new">
              <Plus className="mr-2 h-4 w-4" />
              创建任务
            </Link>
          </Button>
        </div>
      </div>

      {/* 搜索与筛选 —— 圆角搜索条 */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="搜索任务标题..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 rounded-full border-slate-200 bg-slate-50/80 pl-11 pr-4 shadow-inner shadow-slate-900/[0.03]"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as TaskStatus | "all")}
        >
          <SelectTrigger className="h-11 w-full rounded-full border-slate-200 bg-white sm:w-44">
            <Filter className="mr-2 h-4 w-4 text-slate-500" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Task Grid */}
      {filteredTasks.length > 0 ? (
        <div className="grid w-full auto-rows-min grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      ) : (
        <Empty className="py-12">
          <EmptyTitle>暂无任务</EmptyTitle>
          <EmptyDescription>
            {searchQuery || statusFilter !== "all"
              ? "没有找到匹配的任务，试试调整筛选条件"
              : "点击上方按钮创建你的第一个写作任务"}
          </EmptyDescription>
          {!searchQuery && statusFilter === "all" && (
            <Button asChild className="mt-4">
              <Link href="/dashboard/new">
                <Plus className="mr-2 h-4 w-4" />
                创建任务
              </Link>
            </Button>
          )}
        </Empty>
      )}
    </div>
  )
}
