"use client"

import { useState } from "react"
import { Send, Bot, User, Sparkles, Copy, ThumbsUp, RotateCcw } from "lucide-react"
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
  {
    id: "3",
    role: "user",
    content: "苏婉清这个角色的动机是什么？能帮我丰富一下她的背景故事吗？",
    timestamp: "10:26"
  },
  {
    id: "4",
    role: "assistant",
    content: "根据目前的设定，我建议这样构建苏婉清的角色：\n\n**背景**：苏婉清曾是你父亲的学生，在父亲的保护下逃过了1945年的一场清洗。\n\n**动机**：她此次来访有双重目的——表面是为了归还父亲托付给她的遗物，实际上是为了寻找一份能够揭露某权贵家族罪行的证据。\n\n**性格特点**：外表冷静克制，内心却背负着复仇的火焰。她的每一句话都经过深思熟虑，像一盘精心布置的棋局。\n\n需要我把这些设定融入到当前章节中吗？",
    timestamp: "10:27"
  }
]

export function AIChatPanel() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [inputValue, setInputValue] = useState("")
  
  const handleSend = () => {
    if (!inputValue.trim()) return
    
    const newMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    
    setMessages([...messages, newMessage])
    setInputValue("")
    
    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "好的，我正在处理您的请求。让我分析一下当前的故事脉络，然后给出一些建议...",
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      setMessages(prev => [...prev, aiResponse])
    }, 1000)
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
      <ScrollArea className="flex-1">
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
                  "rounded-2xl px-4 py-2.5 text-sm",
                  message.role === "assistant" 
                    ? "bg-muted text-foreground rounded-tl-sm" 
                    : "bg-primary text-primary-foreground rounded-tr-sm"
                )}>
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                </div>
                
                {/* Message Actions for AI */}
                {message.role === "assistant" && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[10px] text-muted-foreground mr-1">{message.timestamp}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <ThumbsUp className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                
                {message.role === "user" && (
                  <span className="text-[10px] text-muted-foreground mt-1">{message.timestamp}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      
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
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            className="flex-1"
          />
          <Button size="icon" onClick={handleSend} disabled={!inputValue.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  )
}
