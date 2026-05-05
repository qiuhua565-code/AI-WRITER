'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Plus, Trash2, Loader2, Key } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { apiKeysApi, ApiKey } from '@/lib/api'

const PROVIDERS = [
  { value: 'claude',   label: 'Claude (Anthropic)' },
  { value: 'aipipe',  label: 'AIPipe 中转 (aipipe.site)' },
  { value: 'openai',   label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'gemini',   label: 'Google Gemini' },
  { value: 'custom',   label: '自定义' },
]

const PURPOSES = [
  { value: 'both',     label: '通用（对话 + 批量生成）' },
  { value: 'chat',     label: 'AI 对话专用' },
  { value: 'generate', label: '批量生成专用' },
]

const PURPOSE_BADGE: Record<string, { label: string; className: string }> = {
  both:     { label: '通用',     className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  chat:     { label: '对话',     className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  generate: { label: '批量生成', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
}

export default function LLMKeyPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ provider: 'claude', purpose: 'both', api_key: '', label: '' })
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const loadKeys = useCallback(() => {
    apiKeysApi.list()
      .then(setKeys)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  const handleAdd = async () => {
    if (!form.api_key.trim()) { setError('请输入 API Key'); return }
    setSubmitting(true)
    setError('')
    try {
      const saved = await apiKeysApi.add(form.provider, form.api_key.trim(), form.purpose, form.label.trim())
      setKeys((prev) => [saved, ...prev])
      setOpen(false)
      setForm({ provider: 'claude', purpose: 'both', api_key: '', label: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      await apiKeysApi.delete(id)
      setKeys((prev) => prev.filter((k) => k.id !== id))
    } catch {
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })

  const resetForm = () => setForm({ provider: 'claude', purpose: 'both', api_key: '', label: '' })

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 lg:p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">API Key 管理</h1>
          <p className="text-sm text-muted-foreground">
            同一账号可添加多条 Key（个人 Key 池）；写稿/对话会从中择优使用。仍可与「系统 Key 池」配合（未绑个人 Key 时回退系统池）。
          </p>
        </div>
        <Button onClick={() => { setOpen(true); setError('') }}>
          <Plus className="mr-2 h-4 w-4" />
          添加 Key
        </Button>
      </div>

      {/* Usage hint */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
        <p className="font-medium">Key 用途说明</p>
        <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs">
          <li><span className="font-medium">批量生成专用</span>：仅供批量自动写稿使用，不占用对话额度</li>
          <li><span className="font-medium">AI 对话专用</span>：仅供审稿页 AI 辅助 / 智能对话使用</li>
          <li><span className="font-medium">通用</span>：两种场景都会使用（未设置专用 Key 时自动回退）</li>
        </ul>
      </div>

      <div className="rounded-lg border border-border">
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">加载中...</div>
        ) : keys.length === 0 ? (
          <div className="py-12 text-center">
            <Key className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">还没有配置 API Key，点击右上角"添加 Key"</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>提供商 / 用途</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const pb = PURPOSE_BADGE[k.purpose] ?? PURPOSE_BADGE.both
                return (
                  <TableRow key={k.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{k.provider}</Badge>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pb.className}`}>
                          {pb.label}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{k.label}</div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{k.key_hint}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(k.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(k.id)}
                        disabled={deletingId === k.id}
                      >
                        {deletingId === k.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(''); resetForm() } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加 API Key</DialogTitle>
            <DialogDescription>同一提供商 + 用途的 Key 会替换旧的，密钥加密保存。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="provider">模型提供商</Label>
              <select
                id="provider"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="purpose">Key 用途</Label>
              <select
                id="purpose"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              >
                {PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                placeholder="sk-..."
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="key-label">备注标签 <span className="text-muted-foreground">（可选）</span></Label>
              <Input
                id="key-label"
                placeholder="例：主力 Key、备用 Key"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleAdd} disabled={submitting}>
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />保存中...</> : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
