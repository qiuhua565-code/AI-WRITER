"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Plus,
  LayoutDashboard,
  Settings,
  LogOut,
  Menu,
  X,
  Key,
  KeyRound,
  Shield,
  MessageSquare,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/lib/store/auth"
import { BrandMark } from "@/components/brand-logo"
import { BRAND_NAME } from "@/lib/brand"

const sidebarItems = [
  { href: "/dashboard", label: "任务列表", icon: LayoutDashboard },
  { href: "/dashboard/new", label: "创建任务", icon: Plus },
  { href: "/dashboard/chat", label: "AI 对话", icon: MessageSquare },
]

const shellCard =
  "rounded-2xl border border-border/70 bg-card shadow-sm shadow-black/[0.03] ring-1 ring-border/40"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, clearAuth, hasHydrated } = useAuthStore()
  const isChatRoute = pathname.startsWith("/dashboard/chat")

  useEffect(() => {
    if (hasHydrated && !user) {
      router.replace("/login")
    }
  }, [user, router, hasHydrated])

  if (!hasHydrated) return null
  if (!user) return null

  const handleLogout = () => {
    clearAuth()
    router.replace("/login")
  }

  const initials = user.email.slice(0, 2).toUpperCase()

  if (isChatRoute) {
    return (
      <div className="min-h-[100dvh] bg-page-cream text-foreground">{children}</div>
    )
  }

  const SidebarBody = () => (
    <>
      <div className={cn(shellCard, "p-4")}>
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 border border-border/80 shadow-sm">
            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{user.email}</p>
            {user.role === "admin" && (
              <span className="mt-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                管理员
              </span>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full rounded-xl border-border text-foreground"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </Button>
      </div>

      <nav className={cn(shellCard, "p-2")} aria-label="主导航">
        {sidebarItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-primary/[0.08] text-foreground ring-1 ring-primary/20"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-80" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className={cn(shellCard, "space-y-0.5 p-2")}>
        <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          账户
        </p>
        <Link
          href="/settings/llm-key"
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted/70"
        >
          <Key className="h-4 w-4" />
          API Key
        </Link>
        <Link
          href="/settings/password"
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted/70"
        >
          <Settings className="h-4 w-4" />
          修改密码
        </Link>
      </div>

      {user.role === "admin" && (
        <div className={cn(shellCard, "space-y-0.5 p-2")}>
          <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            系统管理
          </p>
          <Link
            href="/dashboard/admin"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
              pathname === "/dashboard/admin"
                ? "bg-primary/[0.08] font-medium text-foreground ring-1 ring-primary/20"
                : "text-muted-foreground hover:bg-muted/70"
            )}
          >
            <Shield className="h-4 w-4 shrink-0" />
            管理概览
          </Link>
          <Link
            href="/dashboard/admin/users"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
              pathname.startsWith("/dashboard/admin/users")
                ? "bg-primary/[0.08] font-medium text-foreground ring-1 ring-primary/20"
                : "text-muted-foreground hover:bg-muted/70"
            )}
          >
            <Users className="h-4 w-4 shrink-0" />
            用户管理
          </Link>
          <Link
            href="/dashboard/admin/api-keys"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
              pathname.startsWith("/dashboard/admin/api-keys")
                ? "bg-primary/[0.08] font-medium text-foreground ring-1 ring-primary/20"
                : "text-muted-foreground hover:bg-muted/70"
            )}
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            系统 Key 池
          </Link>
        </div>
      )}
    </>
  )

  return (
    <div className="min-h-screen bg-page-cream text-foreground">
      <div className="flex min-h-screen">
        {/* 桌面侧栏 */}
        <aside className="relative z-20 hidden w-[272px] shrink-0 flex-col gap-3 p-4 lg:flex">
          <Link
            href="/dashboard"
            className="mb-1 flex items-center gap-2.5 px-1"
          >
            <BrandMark size={36} />
            <span className="text-lg font-semibold tracking-tight text-foreground">{BRAND_NAME}</span>
          </Link>
          <SidebarBody />
        </aside>

        {/* 主区 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur-md lg:hidden">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-xl"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开菜单"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
                <BrandMark className="shrink-0" size={32} />
                <span className="truncate font-semibold text-foreground">{BRAND_NAME}</span>
              </Link>
            </div>
          </header>

          <main
            className={cn(
              "flex-1",
              pathname.startsWith("/dashboard/article/") || pathname.startsWith("/dashboard/chat")
                ? ""
                : "p-4 pb-8 sm:p-6"
            )}
          >
            {children}
          </main>
        </div>
      </div>

      {/* 移动侧栏抽屉 */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-[min(100%,300px)] flex-col gap-3 overflow-y-auto bg-page-cream p-4 shadow-2xl lg:hidden"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">菜单</span>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl"
                onClick={() => setSidebarOpen(false)}
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SidebarBody />
          </aside>
        </>
      )}
    </div>
  )
}
