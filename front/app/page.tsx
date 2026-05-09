import Link from "next/link"
import { Shield, ArrowRight, Sparkles, Clock, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BrandMark } from "@/components/brand-logo"
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand"

const shell =
  "rounded-2xl border border-border/80 bg-card shadow-sm shadow-black/[0.03] ring-1 ring-border/35"

export default function HomePage() {
  const features = [
    {
      icon: Sparkles,
      title: "智能撰稿",
      description: "提交标题与参数即可排队生成成稿，专注结构与表达一致性",
    },
    {
      icon: Clock,
      title: "异步任务",
      description: "后台自动执行与重试，随时查看进度，不占用前台时间",
    },
    {
      icon: CheckCircle,
      title: "审校一体",
      description: "成稿后可审核、编辑，并用对话辅助检查与局部改写",
    },
  ]

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-b from-muted/40 via-background to-background">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,var(--color-primary)/0.09,transparent)]" />
        <div className="relative mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center justify-center rounded-full border border-border/80 bg-card/90 p-2 shadow-sm backdrop-blur">
              <BrandMark size={28} />
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem] lg:leading-[1.15]">
              {BRAND_NAME}
              <span className="mt-2 block text-2xl font-normal text-muted-foreground sm:text-3xl sm:font-light">
                任务化内容生产 · 更快出稿
              </span>
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              {BRAND_DESCRIPTION}
            </p>
            <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Button size="lg" className="rounded-full px-8 shadow-md shadow-primary/15" asChild>
                <Link href="/dashboard">
                  开始使用
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="rounded-full border-border/80 bg-background" asChild>
                <Link href="/dashboard/admin">
                  <Shield className="mr-2 h-5 w-5" />
                  管理后台
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className={shell}>
              <CardHeader className="pb-2">
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/[0.08] ring-1 ring-border/50">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-lg text-foreground">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <footer className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <BrandMark size={36} />
              <span className="font-semibold text-foreground">{BRAND_NAME}</span>
            </div>
            <p className="text-sm text-muted-foreground">AI 撰稿与任务管理</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
