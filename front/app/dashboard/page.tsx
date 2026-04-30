'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksApi } from '@/lib/api'
import { TaskList } from '@/components/dashboard/task-list'
import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list({ page_size: 50 }),
    refetchInterval: 10_000,  // poll every 10 s while tab is open
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
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
