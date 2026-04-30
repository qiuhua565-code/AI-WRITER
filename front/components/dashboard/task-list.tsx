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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">我的任务</h1>
          <p className="text-sm text-muted-foreground">
            共 {total} 个任务
            {pendingReview > 0 && `，${pendingReview} 个待审核`}
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/new">
            <Plus className="mr-2 h-4 w-4" />
            创建任务
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索任务标题..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as TaskStatus | "all")}
        >
          <SelectTrigger className="w-full sm:w-40">
            <Filter className="mr-2 h-4 w-4" />
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
