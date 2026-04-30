"use client"

import { ChevronRight, FileText, Database, User, Palette, BookOpen, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Chapter {
  id: string
  title: string
  status: "drafted" | "pending" | "completed" | "review"
  summary: string
}

interface KnowledgeTag {
  id: string
  type: "character" | "style" | "setting" | "plot"
  label: string
}

const chapters: Chapter[] = [
  { id: "1", title: "第一章：黎明之前", status: "completed", summary: "主角在旧公寓中醒来，发现神秘信件" },
  { id: "2", title: "第二章：陌生人的来访", status: "drafted", summary: "一位神秘女子带来关于过去的线索" },
  { id: "3", title: "第三章：隐藏的真相", status: "review", summary: "调查深入，发现惊人的家族秘密" },
  { id: "4", title: "第四章：抉择时刻", status: "pending", summary: "主角面临艰难的道德抉择" },
  { id: "5", title: "第五章：暗夜追踪", status: "pending", summary: "紧张的追逐戏，真相即将揭晓" },
]

const knowledgeTags: KnowledgeTag[] = [
  { id: "1", type: "character", label: "角色：李明远" },
  { id: "2", type: "character", label: "角色：苏婉清" },
  { id: "3", type: "style", label: "风格：悬疑惊悚" },
  { id: "4", type: "setting", label: "场景：上海1940s" },
  { id: "5", type: "plot", label: "主线：身份谜团" },
  { id: "6", type: "style", label: "基调：紧张压抑" },
]

const statusConfig = {
  completed: { label: "已完成", variant: "default" as const, className: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
  drafted: { label: "草稿", variant: "secondary" as const, className: "bg-amber-500/10 text-amber-600 border-amber-200" },
  review: { label: "审核中", variant: "outline" as const, className: "bg-blue-500/10 text-blue-600 border-blue-200" },
  pending: { label: "待处理", variant: "outline" as const, className: "bg-slate-500/10 text-slate-500 border-slate-200" },
}

const tagTypeConfig = {
  character: { icon: User, className: "bg-violet-500/10 text-violet-600 border-violet-200 hover:bg-violet-500/20" },
  style: { icon: Palette, className: "bg-rose-500/10 text-rose-600 border-rose-200 hover:bg-rose-500/20" },
  setting: { icon: BookOpen, className: "bg-cyan-500/10 text-cyan-600 border-cyan-200 hover:bg-cyan-500/20" },
  plot: { icon: FileText, className: "bg-amber-500/10 text-amber-600 border-amber-200 hover:bg-amber-500/20" },
}

interface ContextSidebarProps {
  isOpen: boolean
  onClose?: () => void
}

export function ContextSidebar({ isOpen, onClose }: ContextSidebarProps) {
  return (
    <aside 
      className={cn(
        "w-72 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 transition-all duration-300",
        "fixed lg:relative inset-y-0 left-0 z-40",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}
    >
      <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
        <h2 className="font-semibold text-sidebar-foreground flex items-center gap-2">
          <FileText className="h-4 w-4" />
          上下文与大纲
        </h2>
        <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      
      <Tabs defaultValue="outline" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2">
          <TabsTrigger value="outline" className="text-xs">大纲</TabsTrigger>
          <TabsTrigger value="knowledge" className="text-xs">知识库</TabsTrigger>
        </TabsList>
        
        <TabsContent value="outline" className="flex-1 mt-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-[calc(100vh-180px)]">
            <div className="p-4 space-y-2">
              {chapters.map((chapter) => (
                <div
                  key={chapter.id}
                  className="group p-3 rounded-lg hover:bg-sidebar-accent cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-sidebar-foreground transition-colors" />
                      <span className="text-sm font-medium text-sidebar-foreground truncate">
                        {chapter.title}
                      </span>
                    </div>
                    <Badge 
                      variant={statusConfig[chapter.status].variant}
                      className={cn("shrink-0 text-[10px] px-1.5 py-0", statusConfig[chapter.status].className)}
                    >
                      {statusConfig[chapter.status].label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 ml-6 line-clamp-2">
                    {chapter.summary}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value="knowledge" className="flex-1 mt-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-[calc(100vh-180px)]">
            <div className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Database className="h-3.5 w-3.5" />
                <span>AI 正在参考的知识内容</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {knowledgeTags.map((tag) => {
                  const config = tagTypeConfig[tag.type]
                  const Icon = config.icon
                  return (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className={cn(
                        "cursor-pointer transition-colors flex items-center gap-1.5 px-2.5 py-1",
                        config.className
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {tag.label}
                    </Badge>
                  )
                })}
              </div>
              
              <div className="mt-6 p-3 rounded-lg bg-muted/50 border border-border">
                <h4 className="text-xs font-medium text-foreground mb-2">角色关系图谱</h4>
                <p className="text-xs text-muted-foreground">
                  李明远 ↔ 苏婉清 (情感纠葛)
                </p>
                <p className="text-xs text-muted-foreground">
                  李明远 → 神秘组织 (调查目标)
                </p>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
