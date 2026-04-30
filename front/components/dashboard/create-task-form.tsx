"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Sparkles, X, Loader2, FileText, Plus, Upload } from "lucide-react"
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
import { tasksApi } from "@/lib/api"

function parseTxt(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function parseCsv(text: string): string[] {
  const HEADER_KEYWORDS = ["标题", "title", "名称", "name"]
  const lines = text.split(/\r?\n/)
  const titles: string[] = []
  for (const line of lines) {
    const first = line.split(",")[0].trim().replace(/^"|"$/g, "")
    if (!first) continue
    if (HEADER_KEYWORDS.some((k) => first.toLowerCase().includes(k))) continue
    titles.push(first)
  }
  return titles
}

export function CreateTaskForm() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inputText, setInputText] = useState("")
  const [titles, setTitles] = useState<string[]>([])
  const [error, setError] = useState("")

  const addTitles = (incoming: string[]) => {
    const deduped = incoming.filter((t) => !titles.includes(t))
    if (deduped.length > 0) setTitles((prev) => [...prev, ...deduped])
  }

  const parseAndAddTitles = () => {
    addTitles(parseTxt(inputText))
    setInputText("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault()
      parseAndAddTitles()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const parsed = file.name.endsWith(".csv") ? parseCsv(text) : parseTxt(text)
    addTitles(parsed)
    e.target.value = ""
  }

  const handleRemoveTitle = (title: string) => {
    setTitles(titles.filter((t) => t !== title))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (titles.length === 0) return
    setError("")
    setIsSubmitting(true)

    try {
      await tasksApi.batchCreate({
        titles,
        config: {
          template: "emotion_story",
          target_words: 4500,
        },
      })
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请重试")
    } finally {
      setIsSubmitting(false)
    }
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
            输入文章标题，每行一个，AI 将在后台自动生成情感故事
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
              输入标题，每行一个；或上传 .txt / .csv 文件（.csv 取第一列）
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Textarea
              placeholder={"她嫁给有钱人后发现可怕秘密\n丈夫出轨被我妈妈抓了个正着\n小三登门，我直接报了警"}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={6}
              className="font-mono text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {inputText.split("\n").filter((l) => l.trim()).length} 个标题待添加
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  导入文件
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={parseAndAddTitles}
                  disabled={!inputText.trim()}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  添加到列表
                </Button>
              </div>
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
                <CardDescription>共 {titles.length} 个任务待提交</CardDescription>
              </div>
              {titles.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTitles([])}
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
                <p className="text-sm text-muted-foreground">暂无任务，请在上方输入标题</p>
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

          <CardFooter className="flex flex-col gap-3 border-t border-border pt-6">
            {error && <p className="text-sm text-destructive w-full">{error}</p>}
            <div className="flex w-full justify-between">
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
            </div>
          </CardFooter>
        </Card>
      </form>

      {/* Info Card */}
      <Card className="mt-4 border-primary/20 bg-primary/5">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">提示：</strong>
            任务提交后将进入执行队列，AI 会在后台自动生成情感故事（约 4500 字）。
            生成完成后状态变为"待审核"，届时可进入审核页面查看和下载。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
