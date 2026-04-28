"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Sparkles, X, Loader2, FileText, Plus } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function CreateTaskForm() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inputText, setInputText] = useState("")
  const [titles, setTitles] = useState<string[]>([])

  // 从文本输入解析标题（每行一个）
  const parseAndAddTitles = () => {
    const newTitles = inputText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !titles.includes(line))
    
    if (newTitles.length > 0) {
      setTitles([...titles, ...newTitles])
      setInputText("")
    }
  }

  const handleRemoveTitle = (title: string) => {
    setTitles(titles.filter((t) => t !== title))
  }

  const handleClearAll = () => {
    setTitles([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault()
      parseAndAddTitles()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (titles.length === 0) return

    setIsSubmitting(true)

    // 模拟提交延迟
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // 在实际应用中，这里会发送请求到后端
    console.log({ titles })

    // 跳转回任务列表
    router.push("/dashboard")
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">批量创建任务</h1>
          <p className="text-sm text-muted-foreground">
            输入文章标题，每行一个，AI将在后台自动生成文章
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Input Card */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              添加标题
            </CardTitle>
            <CardDescription>
              输入文章标题，每行一个。按 Ctrl + Enter 快速添加
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Textarea
              placeholder="2024年人工智能发展趋势&#10;远程办公最佳实践指南&#10;健康饮食与生活方式&#10;..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={6}
              className="font-mono text-sm"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {inputText.split("\n").filter((l) => l.trim()).length} 个标题待添加
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={parseAndAddTitles}
                disabled={!inputText.trim()}
              >
                <Plus className="mr-2 h-4 w-4" />
                添加到列表
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Task List Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  任务列表
                </CardTitle>
                <CardDescription>
                  共 {titles.length} 个任务待提交
                </CardDescription>
              </div>
              {titles.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="text-destructive hover:text-destructive"
                >
                  清空全部
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {titles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-muted p-3 mb-3">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  暂无任务，请在上方输入标题
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {titles.map((title, index) => (
                  <div
                    key={`${title}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 group hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant="outline" className="shrink-0 w-8 justify-center">
                        {index + 1}
                      </Badge>
                      <span className="text-sm truncate">{title}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleRemoveTitle(title)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-between border-t border-border pt-6">
            <Button type="button" variant="outline" asChild>
              <Link href="/dashboard">取消</Link>
            </Button>
            <Button type="submit" disabled={titles.length === 0 || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  提交 {titles.length} 个任务
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>

      {/* Info Card */}
      <Card className="mt-4 border-primary/20 bg-primary/5">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">提示：</strong>
            任务提交后将进入执行队列，AI会在后台自动生成文章。生成完成后状态会变为"已完成"，届时您可以进入审核页面查看和编辑文章。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
