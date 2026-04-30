'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Key, Loader2, Eye, EyeOff, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store/auth'

export default function LLMKeyPage() {
  const router = useRouter()
  const { user, setAuth, token } = useAuthStore()
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim()) return
    setError('')
    setMessage('')
    setLoading(true)

    try {
      const result = await authApi.updateLLMKey(apiKey)
      setMessage(`API Key 已保存，末4位：${result.hint}`)
      setApiKey('')
      // Refresh user info
      const updatedUser = await authApi.me()
      if (token) setAuth(token, updatedUser)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setError('')
    setMessage('')
    setDeleting(true)

    try {
      await authApi.deleteLLMKey()
      setMessage('API Key 已删除')
      const updatedUser = await authApi.me()
      if (token) setAuth(token, updatedUser)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 lg:p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">API Key 配置</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            当前状态
          </CardTitle>
          <CardDescription>
            {user?.llm_key_hint
              ? `已配置 API Key，末4位：${user.llm_key_hint}`
              : '尚未配置 API Key，请填写下方表单'}
          </CardDescription>
        </CardHeader>
        {user?.llm_key_hint && (
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              删除 API Key
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>设置新的 API Key</CardTitle>
          <CardDescription>
            请填入您的 LLM 代理服务 API Key，密钥会加密存储
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {message && <p className="text-sm text-emerald-600">{message}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={loading || !apiKey.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                '保存 API Key'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
