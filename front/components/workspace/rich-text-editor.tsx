"use client"

import { useState, useRef, useEffect } from "react"
import { RefreshCw, Maximize2, Sparkles, Check, Wand2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface FloatingToolbarProps {
  position: { top: number; left: number }
  onClose: () => void
}

function FloatingToolbar({ position, onClose }: FloatingToolbarProps) {
  const [inputValue, setInputValue] = useState("")
  
  return (
    <div 
      className="absolute z-50 bg-popover border border-border rounded-xl shadow-xl p-3 w-72 animate-in fade-in-0 zoom-in-95 duration-200"
      style={{ 
        top: position.top - 8, 
        left: Math.min(position.left, window.innerWidth - 320),
        transform: 'translateY(-100%)'
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-sm font-medium text-foreground">AI 助手</span>
      </div>
      
      <Input 
        placeholder="让 AI 帮你修改这段文字..."
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        className="mb-3 text-sm h-9"
      />
      
      <div className="flex flex-wrap gap-1.5">
        <Button 
          variant="secondary" 
          size="sm" 
          className="h-7 text-xs gap-1.5 hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          重写
        </Button>
        <Button 
          variant="secondary" 
          size="sm" 
          className="h-7 text-xs gap-1.5 hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          <Maximize2 className="h-3 w-3" />
          扩展
        </Button>
        <Button 
          variant="secondary" 
          size="sm" 
          className="h-7 text-xs gap-1.5 hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          <Wand2 className="h-3 w-3" />
          变换语气
        </Button>
        <Button 
          variant="secondary" 
          size="sm" 
          className="h-7 text-xs gap-1.5 hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          <Check className="h-3 w-3" />
          修正语法
        </Button>
      </div>
    </div>
  )
}

const storyContent = [
  {
    id: "p1",
    text: "黎明前最黑暗的时刻，上海的街道笼罩在一层薄雾中。李明远站在窗前，凝视着对面那栋老旧的洋楼。三年了，他终于回到了这个充满回忆与伤痛的地方。"
  },
  {
    id: "p2", 
    text: "桌上那封信静静地躺着，泛黄的信封上是他熟悉又陌生的笔迹——那是父亲的字迹，可父亲已经去世五年了。信是三天前寄到的，邮戳模糊不清，像是故意被涂抹过。"
  },
  {
    id: "p3",
    text: "「如果你收到这封信，说明时机已到。去老宅的书房，第三排书架，《唐诗三百首》。记住，相信你看到的，但不要相信你听到的。」"
  },
  {
    id: "p4",
    text: "门铃突然响了，打破了清晨的寂静。李明远下意识地将信塞进口袋，缓步走向门口。透过猫眼，他看到一个身着旗袍的女人，面容精致却透着一丝疲惫。她抬起头，仿佛知道他正在看她。"
  },
  {
    id: "p5",
    text: "「李先生，」女人的声音清冷，「我叫苏婉清。关于您父亲的事，我们需要谈谈。」"
  }
]

export function RichTextEditor() {
  const [selectedParagraph, setSelectedParagraph] = useState<string | null>("p3")
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0 })
  const [showToolbar, setShowToolbar] = useState(true)
  const paragraphRefs = useRef<{ [key: string]: HTMLParagraphElement | null }>({})
  
  useEffect(() => {
    if (selectedParagraph && paragraphRefs.current[selectedParagraph]) {
      const el = paragraphRefs.current[selectedParagraph]
      if (el) {
        const rect = el.getBoundingClientRect()
        const container = el.closest('.editor-container')
        const containerRect = container?.getBoundingClientRect()
        if (containerRect) {
          setToolbarPosition({
            top: rect.top - containerRect.top + 16,
            left: rect.left - containerRect.left + 16
          })
        }
      }
    }
  }, [selectedParagraph])
  
  const handleParagraphClick = (id: string) => {
    setSelectedParagraph(id)
    setShowToolbar(true)
  }
  
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-card">
      <ScrollArea className="flex-1">
        <div className="editor-container relative max-w-3xl mx-auto px-6 py-10 lg:px-12">
          {/* Title */}
          <input
            type="text"
            defaultValue="迷雾中的上海"
            className="w-full text-3xl lg:text-4xl font-bold text-foreground bg-transparent border-none outline-none mb-2 font-serif placeholder:text-muted-foreground/50"
            placeholder="输入标题..."
          />
          
          <p className="text-sm text-muted-foreground mb-8">
            悬疑小说 · 第一章 · 草稿
          </p>
          
          {/* Story Content */}
          <div className="space-y-6 relative">
            {storyContent.map((paragraph) => (
              <p
                key={paragraph.id}
                ref={(el) => { paragraphRefs.current[paragraph.id] = el }}
                onClick={() => handleParagraphClick(paragraph.id)}
                className={cn(
                  "text-base lg:text-lg leading-relaxed font-serif text-foreground/90 cursor-text transition-all duration-200 rounded-lg p-3 -mx-3",
                  selectedParagraph === paragraph.id 
                    ? "bg-primary/5 ring-2 ring-primary/20" 
                    : "hover:bg-muted/30"
                )}
              >
                {paragraph.text}
              </p>
            ))}
            
            {/* Floating Toolbar */}
            {showToolbar && selectedParagraph && toolbarPosition.top > 0 && (
              <FloatingToolbar 
                position={toolbarPosition}
                onClose={() => setShowToolbar(false)}
              />
            )}
          </div>
          
          {/* Word Count */}
          <div className="mt-12 pt-6 border-t border-border">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>字数统计：892 字</span>
              <span>最后保存：2 分钟前</span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
