'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store/auth'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand-logo'
import { BRAND_NAME } from '@/lib/brand'

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
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,var(--color-primary)/0.12,transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 h-px w-[min(100%,720px)] -translate-x-1/2 bg-gradient-to-r from-transparent via-border to-transparent"
        aria-hidden
      />

      <div className="relative z-10 border-b border-border/80 bg-muted/30 px-4 py-2.5 text-center text-xs text-muted-foreground backdrop-blur-sm sm:text-sm">
        <span className="font-medium text-foreground">欢迎登录</span>
        <span className="mx-2 hidden sm:inline text-border">|</span>
        <span className="hidden sm:inline">
          欢迎使用 {BRAND_NAME}，请使用管理员分配的账号登录。
        </span>
      </div>

      <div className="relative z-10 flex min-h-[calc(100vh-2.75rem)] flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <BrandMark size={44} />
          <div className="text-center sm:text-left">
            <span className="block text-2xl font-semibold tracking-tight text-foreground">
              {BRAND_NAME}
            </span>
          </div>
        </div>

        <div
          className={cn(
            'w-full max-w-md rounded-2xl border border-border/80 bg-card p-8 shadow-lg shadow-black/[0.04]'
          )}
        >
          <h1 className="text-center text-xl font-semibold text-foreground">用户登录</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            使用邮箱与密码登录
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">用户名 / 邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="请输入用户名或邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11 rounded-xl border-border"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password">密码</Label>
                <span className="text-xs text-muted-foreground">忘记密码请联系管理员</span>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11 rounded-xl border-border"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl text-base font-medium">
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
              className="h-11 w-full rounded-xl"
              onClick={() => router.push('/')}
            >
              返回首页
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            没有账户？请联系管理员开通账号。
          </p>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {BRAND_NAME}
        </p>
      </div>
    </div>
  )
}
