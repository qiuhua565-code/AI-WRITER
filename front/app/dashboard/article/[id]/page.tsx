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

export default function ArticlePage({ params }: ArticlePageProps) {
  const { id } = use(params)
  const taskId = Number(id)
  const router = useRouter()

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Auto-refresh while task is active
      return status === 'writing' || status === 'queued' ? 5_000 : false
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px]" />
      </div>
    )
  }

  if (!task) return notFound()

  // Redirect plan_review tasks to the plan page
  if (task.status === 'plan_review') {
    router.replace(`/dashboard/article/${id}/plan`)
    return null
  }

  return <ArticleEditor task={task} />
}
