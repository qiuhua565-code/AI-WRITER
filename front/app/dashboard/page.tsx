'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import { TaskList } from '@/components/dashboard/task-list'
import { Skeleton } from '@/components/ui/skeleton'

function TaskCardSkeleton() {
  return (
    <div className="flex overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-100">
      <div className="w-1.5 shrink-0 bg-slate-200" />
      <div className="flex-1 space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-10 shrink-0" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-8" />
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list({ page_size: 50 }),
    refetchInterval: 3_000,  // 每 3 秒刷新，实时更新进度
  })

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-11 w-36 rounded-full" />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-sm">
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
        <div className="grid w-full auto-rows-min grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {[...Array(6)].map((_, i) => (
            <TaskCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-12 text-center text-destructive">
        加载失败：{error instanceof Error ? error.message : '未知错误'}
      </div>
    )
  }

  return <TaskList tasks={data?.items ?? []} total={data?.total ?? 0} />
}
