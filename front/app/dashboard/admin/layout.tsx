"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, Users, KeyRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/lib/store/auth"

const tabs = [
  {
    href: "/dashboard/admin",
    label: "概览",
    icon: LayoutDashboard,
    isActive: (p: string) => p === "/dashboard/admin",
  },
  {
    href: "/dashboard/admin/users",
    label: "用户管理",
    icon: Users,
    isActive: (p: string) => p.startsWith("/dashboard/admin/users"),
  },
  {
    href: "/dashboard/admin/api-keys",
    label: "系统 Key 池",
    icon: KeyRound,
    isActive: (p: string) => p.startsWith("/dashboard/admin/api-keys"),
  },
]

export default function DashboardAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, hasHydrated } = useAuthStore()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (!hasHydrated) return
    if (!user) {
      router.replace("/login")
      return
    }
    if (user.role !== "admin") {
      router.replace("/dashboard")
      return
    }
    setAllowed(true)
  }, [user, router, hasHydrated])

  if (!allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        验证权限中…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex flex-wrap gap-2 rounded-2xl border border-slate-200/60 bg-white p-2 shadow-sm shadow-slate-900/[0.04] ring-1 ring-slate-100/80"
        )}
      >
        {tabs.map((t) => {
          const active = t.isActive(pathname)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-amber-50/90 text-slate-900 ring-1 ring-amber-200/60"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <t.icon className="h-4 w-4 shrink-0 opacity-80" />
              {t.label}
            </Link>
          )
        })}
      </div>
      {children}
    </div>
  )
}
