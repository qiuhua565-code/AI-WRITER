'use client'

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { ArticleEditor } from '@/components/dashboard/article-editor'
import { tasksApi } from '@/lib/api'

interface ArticlePageProps {
  params: Promise<{ id: string }>
}

function ArticleEditorSkeleton() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-3.5 w-32" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-52 shrink-0 border-r border-border bg-muted/30 p-3 space-y-1">
          <Skeleton className="h-8 w-full" />
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-8 space-y-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <div className="pt-2 space-y-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
          <div className="pt-2 space-y-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ArticlePage({ params }: ArticlePageProps) {
  const { id } = use(params)
  const taskId = Number(id)
  const router = useRouter()

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'writing' || status === 'queued' ? 5_000 : false
    },
  })

  if (isLoading) return <ArticleEditorSkeleton />

  if (!task) return notFound()

  if (task.status === 'plan_review') {
    router.replace(`/dashboard/article/${id}/plan`)
    return null
  }

  return <ArticleEditor task={task} />
}
