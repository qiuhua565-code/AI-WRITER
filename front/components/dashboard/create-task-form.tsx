"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Sparkles,
  X,
  Loader2,
  FileText,
  Plus,
  Upload,
  ScrollText,
  BookMarked,
  PenLine,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { tasksApi } from "@/lib/api"
import { cn } from "@/lib/utils"

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

/** 阻止浏览器对拖入文件的默认行为（否则会导航/下载） */
function preventFileDropDefault(e: React.DragEvent) {
  const types = e.dataTransfer?.types
  if (!types || ![...types].includes("Files")) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = "copy"
}

function isDocxFile(file: File): boolean {
  const n = file.name.toLowerCase()
  return n.endsWith(".docx") || file.type.includes("wordprocessingml")
}

/** 指令区：纯文本 / Markdown 直接读；Word .docx 用 mammoth 抽正文 */
async function readFileAsInstructionText(file: File): Promise<string> {
  const n = file.name.toLowerCase()
  if (n.endsWith(".doc") && !n.endsWith(".docx")) {
    throw new Error("不支持老版 .doc，请在 Word 中另存为 .docx，或复制正文后粘贴。")
  }
  if (isDocxFile(file)) {
    const mammoth = await import("mammoth")
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    })
    return result.value.trim()
  }
  return (await file.text()).trim()
}

export function CreateTaskForm() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const instructFileRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inputText, setInputText] = useState("")
  const [titles, setTitles] = useState<string[]>([])
  /** 从文件导入的基础指令（长模板），与下方短提示分离 */
  const [instructionDoc, setInstructionDoc] = useState<{
    filename: string
    text: string
  } | null>(null)
  const [docPreviewOpen, setDocPreviewOpen] = useState(false)
  const [batchPrompt, setBatchPrompt] = useState("")
  /** 留空则提交时不传 target_words，后端用默认 18000 */
  const [targetWordsInput, setTargetWordsInput] = useState("")
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
    if (isDocxFile(file)) {
      window.alert("标题列表请使用 .txt 或 .csv。Word 请打开后复制标题到输入框，或先导出为纯文本。")
      e.target.value = ""
      return
    }
    const text = await file.text()
    const parsed = file.name.endsWith(".csv") ? parseCsv(text) : parseTxt(text)
    addTitles(parsed)
    e.target.value = ""
  }

  const loadInstructionFile = async (file: File) => {
    try {
      const text = await readFileAsInstructionText(file)
      if (!text) {
        window.alert("未能从文件中读出文字。")
        return
      }
      setInstructionDoc({ filename: file.name, text })
      setDocPreviewOpen(false)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "无法读取该文件")
    }
  }

  const handleInstructFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await loadInstructionFile(file)
    e.target.value = ""
  }

  const handleInstructionDrop = async (e: React.DragEvent) => {
    preventFileDropDefault(e)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    await loadInstructionFile(file)
  }

  const handleTitlesDrop = async (e: React.DragEvent) => {
    preventFileDropDefault(e)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (isDocxFile(file)) {
      window.alert("标题列表请使用 .txt 或 .csv。Word 请另存为文本或复制到输入框。")
      return
    }
    const text = await file.text()
    const parsed = file.name.toLowerCase().endsWith(".csv")
      ? parseCsv(text)
      : parseTxt(text)
    addTitles(parsed)
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
      let target_words: number | undefined
      const twRaw = targetWordsInput.trim()
      if (twRaw) {
        const n = parseInt(twRaw, 10)
        if (Number.isNaN(n) || n < 10000 || n > 25000) {
          setError("目标总字数须为 10000～25000 之间的整数，或留空使用默认 18000。")
          setIsSubmitting(false)
          return
        }
        target_words = n
      }

      await tasksApi.batchCreate({
        titles,
        config: {
          template: "emotion_story",
          ...(instructionDoc?.text.trim()
            ? {
                instruction_doc_text: instructionDoc.text.trim(),
                instruction_doc_filename: instructionDoc.filename,
              }
            : {}),
          ...(batchPrompt.trim() ? { batch_prompt: batchPrompt.trim() } : {}),
          ...(target_words !== undefined ? { target_words } : {}),
        },
      })
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请重试")
    } finally {
      setIsSubmitting(false)
    }
  }

  const shellCard =
    "rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-900/[0.03] ring-1 ring-slate-100"

  return (
    <div
      className="min-h-[calc(100vh-5rem)] bg-gradient-to-b from-amber-50/40 via-background to-background px-4 pb-16 pt-8 md:px-8"
      onDragOver={preventFileDropDefault}
      onDrop={(e) => {
        preventFileDropDefault(e)
      }}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 shrink-0 rounded-xl"
            asChild
          >
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              批量创建任务
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              可先导入<span className="font-medium text-slate-800">基础指令文档</span>
              ，再在下方填写短提示词；多个标题共用该配置写入后台，生成与改稿都可追溯。
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-6"
          onDragOver={preventFileDropDefault}
          onDrop={(e) => {
            // 落在表单空白处时仍阻止默认，避免整页触发下载
            preventFileDropDefault(e)
          }}
        >
          {/* 基础指令文档（文件） */}
          <section
            className={cn(shellCard, "overflow-hidden")}
            onDragOver={preventFileDropDefault}
            onDrop={handleInstructionDrop}
          >
            <div className="flex items-center gap-2 border-b border-slate-100 bg-amber-50/50 px-5 py-3">
              <ScrollText className="h-5 w-5 text-amber-600" />
              <span className="font-medium text-slate-800">基础指令文档</span>
              <span className="ml-auto text-xs text-slate-500">
                长模板 · 建议用文件导入 · 可选
              </span>
            </div>
            <div className="space-y-3 p-5">
              {!instructionDoc ? (
                <div
                  className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center"
                  onDragOver={preventFileDropDefault}
                  onDrop={handleInstructionDrop}
                >
                  <p className="text-sm text-slate-600">
                    拖入 .txt / .md / .docx，或点击下方选择文件
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    导入后在此展示文档信息，不再混入下方短提示框
                  </p>
                  <input
                    ref={instructFileRef}
                    type="file"
                    accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={handleInstructFile}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4 rounded-xl border-slate-200"
                    onClick={() => instructFileRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    选择指令文档
                  </Button>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {instructionDoc.filename}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        约 {instructionDoc.text.length.toLocaleString()} 字 · 已保存至任务配置
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-slate-600"
                      onClick={() => {
                        setInstructionDoc(null)
                        setDocPreviewOpen(false)
                      }}
                    >
                      移除
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocPreviewOpen((o) => !o)}
                    className="mt-2 text-xs font-medium text-amber-800/90 hover:underline"
                  >
                    {docPreviewOpen ? "收起正文预览" : "查看正文预览"}
                  </button>
                  {docPreviewOpen && (
                    <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-100 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
                      {instructionDoc.text}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 补充提示词（短） */}
          <section className={cn(shellCard, "overflow-hidden")}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
              <PenLine className="h-5 w-5 text-slate-600" />
              <span className="font-medium text-slate-800">补充提示词</span>
              <span className="ml-auto text-xs text-slate-500">直接写给模型的短指令 · 可选</span>
            </div>
            <div className="space-y-3 p-5">
              <Textarea
                placeholder={`例如：\n- 本章强化对话占比\n- 某角色口吻偏冷\n- 审核重点：避免真人信息`}
                value={batchPrompt}
                onChange={(e) => setBatchPrompt(e.target.value)}
                rows={5}
                className="min-h-[120px] resize-y border-slate-200 bg-white text-[15px] leading-relaxed text-slate-800 placeholder:text-slate-400"
              />
            </div>
          </section>

          {/* 目标字数 */}
          <section className={cn(shellCard, "overflow-hidden")}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
              <Sparkles className="h-5 w-5 text-amber-600" />
              <span className="font-medium text-slate-800">成稿目标总字数</span>
              <span className="ml-auto text-xs text-slate-500">留空则默认 18000 · 最低 10000</span>
            </div>
            <div className="p-5">
              <div className="flex flex-wrap items-end gap-4">
                <div className="min-w-[200px] flex-1 space-y-1.5">
                  <label className="text-xs font-medium text-slate-600" htmlFor="target-words">
                    汉字（全文各章合计目标）
                  </label>
                  <Input
                    id="target-words"
                    type="number"
                    min={10000}
                    max={25000}
                    placeholder="默认 18000"
                    value={targetWordsInput}
                    onChange={(e) => setTargetWordsInput(e.target.value)}
                    className="rounded-xl border-slate-200"
                  />
                </div>
                <p className="pb-2 text-xs leading-relaxed text-slate-500">
                  基础文档里若写了「四五千字」等，与长篇管线不一致时，以这里为准；不填则系统按约 1.8
                  万字拆解章节生成。
                </p>
              </div>
            </div>
          </section>

          {/* Titles */}
          <section
            className={cn(shellCard, "overflow-hidden")}
            onDragOver={preventFileDropDefault}
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
              <BookMarked className="h-5 w-5 text-slate-600" />
              <span className="font-medium text-slate-800">文章标题</span>
              <Badge variant="secondary" className="ml-auto font-normal">
                {titles.length} 篇
              </Badge>
            </div>
            <div className="space-y-4 p-5">
              <Textarea
                placeholder={
                  "每行一个标题，例如：\n她嫁给有钱人后发现可怕秘密\n丈夫出轨被我妈妈抓了个正着"
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                onDragOver={preventFileDropDefault}
                onDrop={handleTitlesDrop}
                rows={6}
                className="border-slate-200 bg-white font-mono text-sm text-slate-800"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Ctrl+Enter 快速加入列表 · 支持 .txt / .csv 导入标题 ·
                  <span className="text-slate-600">可拖文件到上方输入框。</span>
                </p>
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-slate-200"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    导入标题文件
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="rounded-xl"
                    onClick={parseAndAddTitles}
                    disabled={!inputText.trim()}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    添加到列表
                  </Button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4">
              {titles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-3 rounded-full bg-white p-3 shadow-sm ring-1 ring-slate-100">
                    <FileText className="h-7 w-7 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500">尚未添加标题</p>
                </div>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {titles.map((title, index) => (
                    <li
                      key={`${title}-${index}`}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 transition hover:border-amber-200/80 hover:bg-amber-50/30"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-medium text-slate-600">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm text-slate-800">{title}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 opacity-0 transition group-hover:opacity-100"
                        onClick={() => handleRemoveTitle(title)}
                      >
                        <X className="h-4 w-4 text-slate-500" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <Button type="button" variant="outline" className="rounded-xl" asChild>
              <Link href="/dashboard">取消</Link>
            </Button>
            <Button
              type="submit"
              disabled={titles.length === 0 || isSubmitting}
              className="rounded-xl bg-slate-900 text-white hover:bg-slate-800"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  提交中…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4 text-amber-300" />
                  提交 {titles.length} 个任务
                </>
              )}
            </Button>
          </div>
        </form>

        <p className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-slate-700">
          <span className="font-medium text-slate-900">提示：</span>
          任务进入队列后将在后台生成；基础指令文档与补充提示、目标字数会写入每个任务的配置，在文章审核页「AI
          改稿」侧栏可展开查看。
        </p>
      </div>
    </div>
  )
}
