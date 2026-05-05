'use client'

import { use, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle,
  Loader2,
  PlayCircle,
  Users,
  Clock,
  Layers,
  MessageSquare,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { tasksApi } from '@/lib/api'
import { StoryPlan } from '@/lib/types'

interface PlanPageProps {
  params: Promise<{ id: string }>
}

export default function PlanReviewPage({ params }: PlanPageProps) {
  const { id } = use(params)
  const taskId = Number(id)
  const router = useRouter()
  const queryClient = useQueryClient()
  const [resumeError, setResumeError] = useState('')

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId),
    refetchInterval: 5_000,
  })

  const resumeMutation = useMutation({
    mutationFn: () => tasksApi.control(taskId, 'resume'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      router.push('/dashboard')
    },
    onError: (err) => {
      setResumeError(err instanceof Error ? err.message : '操作失败')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => tasksApi.control(taskId, 'cancel'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      router.push('/dashboard')
    },
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 p-4 lg:p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-16 ml-1" />
        </div>
        {/* Main plan card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <Skeleton className="h-5 w-48" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        {/* Characters card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <Skeleton className="h-5 w-24" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3.5 w-full" />
              </div>
            </div>
          ))}
        </div>
        {/* Chapters card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <Skeleton className="h-5 w-20" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded-full shrink-0" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!task) return null

  const plan = task.outline as StoryPlan | null

  if (!plan) {
    return (
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        <p className="text-muted-foreground">规划尚未生成</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">审核故事规划</h1>
          <p className="text-sm text-muted-foreground">{task.title}</p>
        </div>
        <Badge className="ml-auto bg-violet-500/10 text-violet-600">待审规划</Badge>
      </div>

      {/* Plan Cards */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            故事框架
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoField label="故事类型" value={plan.story_type} />
            <InfoField label="标题解读" value={plan.title_interpretation} />
          </div>
          <InfoField label="核心冲突" value={plan.core_conflict} />
          <InfoField label="事件时间线" value={plan.event_timeline} />
          <InfoField label="戏剧性开场" value={plan.dramatic_scene} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            主要人物
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {plan.key_characters.map((char, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Badge variant="outline" className="shrink-0 mt-0.5">{char.role}</Badge>
                <div>
                  <p className="font-medium text-sm">{char.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{char.background}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            免费部分情节点
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {plan.free_part_beats.map((beat, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{beat}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            付费设计
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoField label="卡点悬念" value={plan.paywall_hook} />
          <InfoField label="付费揭示内容" value={plan.paid_part_revelation} />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          onClick={() => cancelMutation.mutate()}
          disabled={cancelMutation.isPending}
          className="text-destructive hover:text-destructive"
        >
          {cancelMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ArrowLeft className="mr-2 h-4 w-4" />
          )}
          放弃此任务
        </Button>

        <Button
          onClick={() => resumeMutation.mutate()}
          disabled={resumeMutation.isPending}
        >
          {resumeMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-2 h-4 w-4" />
          )}
          确认规划，开始写作
        </Button>
      </div>

      {(resumeError) && (
        <p className="text-sm text-destructive">{resumeError}</p>
      )}
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  )
}
