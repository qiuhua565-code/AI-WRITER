"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Bot, User, Sparkles, Copy, ThumbsUp, RotateCcw, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
  isStreaming?: boolean
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "user",
    content: "可以帮我把第二章的结尾写得更有戏剧性吗？",
    timestamp: "10:23"
  },
  {
    id: "2",
    role: "assistant",
    content: "当然可以！我已经更新了编辑器中的内容。现在主角在打开门的那一刻，发现来访者不仅知道他父亲的事，还带来了一封尘封多年的信件，信件上的蜡封暗示着某个神秘组织的介入。这个转折增加了悬念，为下一章的冲突埋下伏笔。",
    timestamp: "10:24"
  },
]

export function AIChatPanelEnhanced() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [inputValue, setInputValue] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)

  // 检测用户是否在底部
  const checkIfAtBottom = () => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return true

    const { scrollTop, scrollHeight, clientHeight } = scrollArea
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // 距离底部小于 100px 认为在底部
    return distanceFromBottom < 100
  }

  // 滚动到底部
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end"
    })
  }

  // 监听滚动事件
  const handleScroll = () => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    const currentScrollTop = scrollArea.scrollTop
    const isScrollingUp = currentScrollTop < lastScrollTop.current
    lastScrollTop.current = currentScrollTop

    const atBottom = checkIfAtBottom()

    // 用户向上滚动时，停止自动滚动
    if (isScrollingUp && !atBottom) {
      setAutoScroll(false)
      setShowScrollButton(true)
    }

    // 用户滚动到底部时，恢复自动滚动
    if (atBottom) {
      setAutoScroll(true)
      setShowScrollButton(false)
    } else {
      setShowScrollButton(true)
    }
  }

  // 当消息更新时，根据 autoScroll 决定是否滚动
  useEffect(() => {
    if (autoScroll) {
      scrollToBottom(true)
    }
  }, [messages, autoScroll])

  // 点击"滚动到底部"按钮
  const handleScrollToBottom = () => {
    setAutoScroll(true)
    scrollToBottom(true)
  }

  const handleSend = () => {
    if (!inputValue.trim() || isStreaming) return

    const newMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    setMessages([...messages, newMessage])
    setInputValue("")
    setIsStreaming(true)

    // 发送消息时自动滚动到底部
    setAutoScroll(true)

    // 模拟流式响应
    const aiMessageId = (Date.now() + 1).toString()
    const aiMessage: Message = {
      id: aiMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      isStreaming: true
    }

    setMessages(prev => [...prev, aiMessage])

    // 模拟流式输出
    const fullResponse = "好的，我正在处理您的请求。让我分析一下当前的故事脉络，然后给出一些建议。这是一段比较长的回复，用来测试自动滚动功能是否正常工作。当内容很长时，应该能够看到滚动效果。如果用户向上滚动查看历史消息，自动滚动应该停止。当用户滚动回底部时，自动滚动应该恢复。"
    let currentIndex = 0

    const streamInterval = setInterval(() => {
      if (currentIndex < fullResponse.length) {
        const chunk = fullResponse.slice(currentIndex, currentIndex + 2)
        currentIndex += 2

        setMessages(prev => prev.map(msg =>
          msg.id === aiMessageId
            ? { ...msg, content: msg.content + chunk }
            : msg
        ))
      } else {
        clearInterval(streamInterval)
        setMessages(prev => prev.map(msg =>
          msg.id === aiMessageId
            ? { ...msg, isStreaming: false }
            : msg
        ))
        setIsStreaming(false)
      }
    }, 50)
  }

  return (
    <aside className="w-80 xl:w-96 bg-sidebar border-l border-sidebar-border flex flex-col shrink-0 hidden lg:flex">
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sidebar-foreground">AI 写作助手</h2>
            <p className="text-xs text-muted-foreground">随时为您提供创作灵感</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 relative">
        <ScrollArea
          className="h-full"
          ref={scrollAreaRef}
          onScroll={handleScroll}
        >
          <div className="p-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-3",
                  message.role === "user" ? "flex-row-reverse" : ""
                )}
              >
                <Avatar className={cn(
                  "h-8 w-8 shrink-0",
                  message.role === "assistant" ? "bg-primary/10" : "bg-muted"
                )}>
                  <AvatarFallback className={cn(
                    message.role === "assistant" ? "text-primary" : "text-muted-foreground"
                  )}>
                    {message.role === "assistant" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>

                <div className={cn(
                  "flex flex-col max-w-[85%]",
                  message.role === "user" ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm select-text",
                    message.role === "assistant"
                      ? "bg-muted text-foreground rounded-tl-sm"
                      : "bg-muted text-foreground rounded-tr-sm border border-border/50"
                  )}>
                    <p className="whitespace-pre-wrap leading-relaxed select-text">
                      {message.content}
                      {message.isStreaming && <span className="inline-block w-1 h-4 ml-1 bg-primary animate-pulse" />}
                    </p>
                  </div>

                  {/* Message Actions */}
                  {!message.isStreaming && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="text-[10px] text-muted-foreground mr-1">{message.timestamp}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => navigator.clipboard.writeText(message.content)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      {message.role === "assistant" && (
                        <>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <ThumbsUp className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* 滚动到底部按钮 */}
        {showScrollButton && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full shadow-lg"
              onClick={handleScrollToBottom}
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              回到底部
            </Button>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-4 py-2 border-t border-sidebar-border">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="text-xs h-7">
            续写下一段
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7">
            角色对话
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7">
            场景描写
          </Button>
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex gap-2">
          <Input
            placeholder="输入您的问题或指令..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
                e.preventDefault()
                handleSend()
              }
            }}
            className="flex-1"
            disabled={isStreaming}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {isStreaming && (
          <p className="text-xs text-muted-foreground mt-2">AI 正在思考中...</p>
        )}
      </div>
    </aside>
  )
}
