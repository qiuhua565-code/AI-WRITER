import Link from "next/link"
import { FileText, Shield, ArrowRight, Sparkles, Clock, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const shell =
  "rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-900/[0.05] ring-1 ring-slate-100/90"

export default function HomePage() {
  const features = [
    {
      icon: Sparkles,
      title: "AI智能写作",
      description: "只需提供标题和参数，AI自动在后台生成高质量文章",
    },
    {
      icon: Clock,
      title: "后台任务执行",
      description: "任务提交后自动排队执行，无需等待，随时查看进度",
    },
    {
      icon: CheckCircle,
      title: "便捷审核编辑",
      description: "AI生成完成后审核文章，支持直接编辑和AI辅助修改",
    },
  ]

  return (
    <div className="min-h-screen bg-page-cream">
      <div className="relative overflow-hidden border-b border-amber-200/35 bg-gradient-to-br from-[#fff9f2] via-white to-violet-50/40">
        <div className="pointer-events-none absolute -right-16 top-0 h-64 w-64 rounded-full bg-violet-200/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-48 w-48 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="relative mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-white/90 px-4 py-2 text-sm font-medium text-slate-800 shadow-sm">
              <Sparkles className="h-4 w-4 text-amber-600" />
              AI驱动的智能写作平台
            </div>
            <h1 className="text-balance text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              让AI为您创作
              <br />
              <span className="bg-gradient-to-r from-violet-700 to-amber-700 bg-clip-text text-transparent">
                高质量文章
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-slate-600">
              AI-StoryFlow 是一个任务驱动的AI写作系统。只需提交任务参数，
              AI会在后台自动生成文章，您只需审核和发布。
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                size="lg"
                className="rounded-full bg-slate-900 px-8 shadow-lg shadow-slate-900/15 hover:bg-slate-800"
                asChild
              >
                <Link href="/dashboard">
                  <FileText className="mr-2 h-5 w-5" />
                  进入工作台
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="rounded-full border-slate-200 bg-white" asChild>
                <Link href="/dashboard/admin">
                  <Shield className="mr-2 h-5 w-5" />
                  管理后台
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className={shell}>
              <CardHeader className="pb-2">
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-amber-50 ring-1 ring-slate-100">
                  <feature.icon className="h-5 w-5 text-violet-700" />
                </div>
                <CardTitle className="text-lg text-slate-900">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed text-slate-600">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <footer className="border-t border-amber-200/40 bg-white/60">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 shadow-sm">
                <FileText className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold text-slate-900">AI-StoryFlow</span>
            </div>
            <p className="text-sm text-slate-500">AI驱动的智能写作平台</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
