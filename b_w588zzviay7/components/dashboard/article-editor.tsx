"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Sparkles,
  RefreshCw,
  Wand2,
  FileText,
  Clock,
  Loader2,
  Bot,
  User,
  Settings2,
  Send,
  ChevronDown,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { WritingTask, TaskStatus, AIMessage, AI_MODELS } from "@/lib/types"

interface ArticleEditorProps {
  task: WritingTask
}

const statusConfig: Record<TaskStatus, { label: string; color: string }> = {
  pending: { label: "等待执行", color: "bg-muted text-muted-foreground" },
  processing: { label: "执行中", color: "bg-primary/10 text-primary" },
  completed: { label: "待审核", color: "bg-amber-500/10 text-amber-600" },
  approved: { label: "已通过", color: "bg-emerald-500/10 text-emerald-600" },
  rejected: { label: "已拒绝", color: "bg-destructive/10 text-destructive" },
}

export function ArticleEditor({ task }: ArticleEditorProps) {
  const router = useRouter()
  const [content, setContent] = useState(task.content || "")
  const [hasChanges, setHasChanges] = useState(false)
  const [showApproveDialog, setShowApproveDialog] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedText, setSelectedText] = useState("")
  const [aiInstruction, setAiInstruction] = useState("")
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0])
  const [isAIProcessing, setIsAIProcessing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const status = statusConfig[task.status]
  const aiChatHistory = task.aiChatHistory || []

  const handleContentChange = (value: string) => {
    setContent(value)
    setHasChanges(value !== task.content)
  }

  const handleTextSelect = () => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart
      const end = textareaRef.current.selectionEnd
      if (start !== end) {
        setSelectedText(content.substring(start, end))
      } else {
        setSelectedText("")
      }
    }
  }

  const handleApprove = async () => {
    setIsProcessing(true)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setShowApproveDialog(false)
    setIsProcessing(false)
    router.push("/dashboard")
  }

  const handleReject = async () => {
    setIsProcessing(true)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setShowRejectDialog(false)
    setIsProcessing(false)
    router.push("/dashboard")
  }

  const handleAISend = async () => {
    if (!aiInstruction.trim()) return
    setIsAIProcessing(true)
    // 模拟AI处理
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setAiInstruction("")
    setSelectedText("")
    setIsAIProcessing(false)
  }

  const quickAIActions = [
    { label: "润色", instruction: "请润色优化这段文字" },
    { label: "扩展", instruction: "请扩展这段内容" },
    { label: "精简", instruction: "请精简这段文字" },
    { label: "修正", instruction: "请修正语法错误" },
  ]

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{task.title}</h1>
              <Badge className={cn("shrink-0", status.color)}>{status.label}</Badge>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {new Date(task.createdAt).toLocaleDateString("zh-CN")}
              </span>
              {task.wordCount && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {task.wordCount}字
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {task.status === "completed" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowRejectDialog(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              退回重写
            </Button>
            <Button onClick={() => setShowApproveDialog(true)}>
              <CheckCircle className="mr-2 h-4 w-4" />
              审核通过
            </Button>
          </div>
        )}
      </div>

      {/* Main Content - Three Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column - AI Chat History */}
        <div className="w-80 shrink-0 border-r border-border bg-muted/30">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <Bot className="h-4 w-4 text-primary" />
                AI执行记录
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                后台任务的AI对话历史
              </p>
            </div>
            <ScrollArea className="flex-1 p-4">
              {aiChatHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <Bot className="mb-2 h-8 w-8 opacity-50" />
                  <p className="text-sm">暂无执行记录</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {aiChatHistory.map((msg) => (
                    <div key={msg.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        {msg.role === "system" ? (
                          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : msg.role === "assistant" ? (
                          <Bot className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <User className="h-3.5 w-3.5 text-foreground" />
                        )}
                        <span className="text-xs font-medium text-muted-foreground">
                          {msg.role === "system" ? "系统" : msg.role === "assistant" ? "AI助手" : "用户"}
                        </span>
                        <span className="text-xs text-muted-foreground/60">
                          {formatTime(msg.timestamp)}
                        </span>
                        {msg.model && (
                          <Badge variant="outline" className="ml-auto h-5 text-[10px]">
                            {msg.model}
                          </Badge>
                        )}
                      </div>
                      <div
                        className={cn(
                          "rounded-lg px-3 py-2 text-sm",
                          msg.role === "system"
                            ? "bg-muted text-muted-foreground"
                            : msg.role === "assistant"
                            ? "bg-primary/10 text-foreground"
                            : "bg-card text-foreground"
                        )}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Middle Column - Article Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-6 py-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">文章内容</h2>
              {hasChanges && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-600">有未保存的修改</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setContent(task.content || "")
                      setHasChanges(false)
                    }}
                  >
                    放弃
                  </Button>
                  <Button size="sm">保存</Button>
                </div>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1 p-6">
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onSelect={handleTextSelect}
              onMouseUp={handleTextSelect}
              className="min-h-[800px] resize-none border-0 bg-transparent font-serif text-base leading-relaxed shadow-none focus-visible:ring-0"
              placeholder="文章内容..."
            />
          </ScrollArea>
        </div>

        {/* Right Column - AI Assist */}
        <div className="w-80 shrink-0 border-l border-border bg-muted/30">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <Wand2 className="h-4 w-4 text-primary" />
                AI辅助修改
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                选中文字后可使用AI修改
              </p>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {/* Model Selector */}
              <div className="mb-4">
                <label className="mb-2 block text-xs font-medium text-muted-foreground">
                  选择模型
                </label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      <span className="flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        {selectedModel.name}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-72" align="start">
                    {AI_MODELS.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => setSelectedModel(model)}
                        className="flex flex-col items-start py-2"
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="font-medium">{model.name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {model.provider}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {model.description}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Selected Text Display */}
              {selectedText && (
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    选中的内容
                  </label>
                  <div className="rounded-lg bg-card p-3 text-sm">
                    <p className="line-clamp-4 text-muted-foreground">{selectedText}</p>
                    <p className="mt-1 text-xs text-primary">共 {selectedText.length} 字</p>
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="mb-4">
                <label className="mb-2 block text-xs font-medium text-muted-foreground">
                  快捷操作
                </label>
                <div className="flex flex-wrap gap-2">
                  {quickAIActions.map((action) => (
                    <Button
                      key={action.label}
                      variant="outline"
                      size="sm"
                      disabled={!selectedText}
                      onClick={() => setAiInstruction(action.instruction)}
                      className={cn(
                        "text-xs",
                        aiInstruction === action.instruction && "border-primary bg-primary/5"
                      )}
                    >
                      <Sparkles className="mr-1 h-3 w-3" />
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Custom Instruction */}
              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">
                  自定义指令
                </label>
                <Textarea
                  placeholder="输入修改指令，例如：请将这段改写成更加生动的描写..."
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>

            {/* Send Button */}
            <div className="border-t border-border p-4">
              <Button
                className="w-full"
                disabled={!aiInstruction.trim() || !selectedText || isAIProcessing}
                onClick={handleAISend}
              >
                {isAIProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isAIProcessing ? "处理中..." : "发送指令"}
              </Button>
              {!selectedText && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  请先在文章中选中要修改的内容
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认审核通过</DialogTitle>
            <DialogDescription>
              审核通过后，该文章将标记为已完成状态。确定要通过审核吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              取消
            </Button>
            <Button onClick={handleApprove} disabled={isProcessing}>
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              确认通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认退回重写</DialogTitle>
            <DialogDescription>
              退回后，该任务将重新进入执行队列，AI会重新生成文章。确定要退回吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isProcessing}>
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              确认退回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
