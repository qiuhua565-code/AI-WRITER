import Link from "next/link"
import { FileText, Shield, ArrowRight, Sparkles, Clock, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

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
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="relative mx-auto max-w-5xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              AI驱动的智能写作平台
            </div>
            <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              让AI为您创作
              <br />
              <span className="text-primary">高质量文章</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
              AI-StoryFlow 是一个任务驱动的AI写作系统。只需提交任务参数，
              AI会在后台自动生成文章，您只需审核和发布。
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/dashboard">
                  <FileText className="mr-2 h-5 w-5" />
                  进入工作台
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/admin">
                  <Shield className="mr-2 h-5 w-5" />
                  管理后台
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="border-border/50">
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <FileText className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground">AI-StoryFlow</span>
            </div>
            <p className="text-sm text-muted-foreground">
              AI驱动的智能写作平台
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
