'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store/auth'
import { cn } from '@/lib/utils'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { access_token, user } = await authApi.login(email, password)
      setAuth(access_token, user)
      window.location.href = '/dashboard'
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fff9f0] text-foreground">
      {/* 装饰几何 */}
      <div
        className="pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-pink-400/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-32 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-[15%] top-[60%] h-4 w-4 rounded-full bg-blue-400/40 shadow-lg sm:h-6 sm:w-6"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute right-[20%] top-[25%] h-3 w-3 rounded-full bg-pink-400/50 sm:h-5 sm:w-5"
        aria-hidden
      />

      {/* 顶部公告 */}
      <div className="relative z-10 border-b border-amber-200/60 bg-amber-100/70 px-4 py-2 text-center text-xs text-amber-950/90 backdrop-blur-sm sm:text-sm">
        <span className="font-medium">登录公告</span>
        <span className="mx-2 hidden sm:inline">·</span>
        <span className="hidden sm:inline">
          欢迎使用 AI-StoryFlow，请使用管理员分配的账号登录。
        </span>
      </div>

      <div className="relative z-10 flex min-h-[calc(100vh-2.5rem)] flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2563eb] shadow-md shadow-blue-500/25">
            <FileText className="h-6 w-6 text-white" />
          </div>
          <span className="text-2xl font-semibold tracking-tight text-slate-900">
            AI-StoryFlow
          </span>
        </div>

        <div
          className={cn(
            'w-full max-w-md rounded-2xl border border-white/80 bg-white/95 p-8 shadow-xl shadow-slate-900/10',
            'backdrop-blur-sm'
          )}
        >
          <h1 className="text-center text-xl font-semibold text-slate-900">
            用户登录
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            使用邮箱与密码进入工作台
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700">
                用户名 / 邮箱
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="请输入用户名或邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11 rounded-xl border-slate-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password" className="text-slate-700">
                  密码
                </Label>
                <span className="text-xs text-muted-foreground">
                  忘记密码请联系管理员
                </span>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11 rounded-xl border-slate-200 bg-white"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-xl bg-[#2563eb] text-base font-medium hover:bg-[#1d4ed8]"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登录中…
                </>
              ) : (
                '登录'
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50"
              onClick={() => router.push('/')}
            >
              返回首页
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            没有账户？请联系管理员开通账号。
          </p>
        </div>

        <p className="mt-10 text-center text-xs text-slate-500">
          Copyright © {new Date().getFullYear()} AI-StoryFlow
        </p>
      </div>
    </div>
  )
}
