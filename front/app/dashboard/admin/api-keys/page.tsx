'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2, Key, Zap, RefreshCw, PowerOff, Unlock } from 'lucide-react'
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
import { systemKeysApi, SystemKey } from '@/lib/api'

const PROVIDERS = [
  { value: 'claude',   label: 'Claude (Anthropic)' },
  { value: 'aipipe',  label: 'AIPipe 中转 (aipipe.site)' },
  { value: 'openai',   label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'gemini',   label: 'Google Gemini' },
  { value: 'custom',   label: '自定义' },
]

const PURPOSES = [
  { value: 'both',  label: '写稿 + 对话（通用）' },
  { value: 'task',  label: '仅写稿任务' },
  { value: 'chat',  label: '仅对话 / 辅助修改' },
]

const purposeConfig: Record<string, { label: string; cls: string }> = {
  both: { label: '通用',    cls: 'bg-primary/10 text-primary' },
  task: { label: '写稿',    cls: 'bg-muted text-foreground' },
  chat: { label: '对话',    cls: 'bg-emerald-500/10 text-emerald-600' },
}

export default function AdminApiKeysPage() {
  const [keys, setKeys] = useState<SystemKey[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ provider: 'aipipe', purpose: 'both', api_key: '', label: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [actionId, setActionId] = useState<number | null>(null)

  const loadKeys = useCallback(() => {
    setLoading(true)
    systemKeysApi.list()
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
      const saved = await systemKeysApi.add(form.provider, form.api_key.trim(), form.purpose, form.label.trim())
      setKeys((prev) => [saved, ...prev])
      setOpen(false)
      setForm({ provider: 'aipipe', purpose: 'both', api_key: '', label: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    setActionId(id)
    try {
      await systemKeysApi.delete(id)
      setKeys((prev) => prev.filter((k) => k.id !== id))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '删除失败')
    } finally {
      setActionId(null)
    }
  }

  const handleRelease = async (id: number) => {
    setActionId(id)
    try {
      await systemKeysApi.release(id)
      setKeys((prev) => prev.map((k) => k.id === id ? { ...k, in_use: false } : k))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '释放失败')
    } finally {
      setActionId(null)
    }
  }

  const handleToggle = async (id: number) => {
    setActionId(id)
    try {
      const res = await systemKeysApi.toggle(id)
      setKeys((prev) => prev.map((k) => k.id === id ? { ...k, is_active: res.is_active } : k))
    } catch {
    } finally {
      setActionId(null)
    }
  }

  const activeCount = keys.filter((k) => k.is_active && k.purpose !== 'chat').length
  const chatKeyCount = keys.filter((k) => k.is_active && k.purpose !== 'task').length
  const inUseCount = keys.filter((k) => k.in_use).length

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">系统 API Key 池</h1>
          <p className="text-sm text-muted-foreground">管理全局 Key 池；用户未绑定个人 Key 时将使用此池</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadKeys} title="刷新">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => { setOpen(true); setError('') }}>
            <Plus className="mr-2 h-4 w-4" />
            添加 Key
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Key 总数</p>
          <p className="mt-1 text-2xl font-bold">{keys.length}</p>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 dark:border-primary/30 dark:bg-primary/10">
          <p className="text-xs text-primary dark:text-primary">写稿最大并发</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{activeCount} 个任务</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
          <p className="text-xs text-emerald-600 dark:text-emerald-400">对话可用 Key</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{chatKeyCount} 个</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/50 p-4 dark:border-border dark:bg-muted/30">
          <p className="text-xs text-muted-foreground">写稿占用中</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{inUseCount} 个 Key</p>
        </div>
      </div>

      {/* Key rule hint */}
      <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-xs text-foreground dark:border-primary/25 dark:bg-primary/10">
        <span className="font-medium">用途说明：</span>
        「写稿」Key 用于异步生文任务，每个 Key 同时只跑 1 个任务（排他锁），配 N 个 = 最多 N 路并发；
        「对话」Key 专供 AI 对话和辅助修改，不加锁，不互相占用；
        「通用」Key 两者均可使用，建议至少各配 1 个专用 Key 以避免互相抢占。
      </div>

      <div className="rounded-lg border border-border">
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">加载中...</div>
        ) : keys.length === 0 ? (
          <div className="py-12 text-center">
            <Key className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">还没有配置系统 Key，点击右上角"添加 Key"</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>提供商</TableHead>
                <TableHead>用途</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const pc = purposeConfig[k.purpose] ?? purposeConfig.both
                return (
                <TableRow key={k.id} className={!k.is_active ? 'opacity-50' : ''}>
                  <TableCell>
                    <div>
                      <Badge variant="secondary">{k.provider}</Badge>
                      {k.label && <div className="mt-0.5 text-xs text-muted-foreground">{k.label}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pc.cls}`}>
                      {pc.label}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{k.key_hint}</TableCell>
                  <TableCell>
                    {k.in_use ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary dark:bg-primary/20">
                        <Zap className="h-3 w-3" />
                        使用中
                      </span>
                    ) : k.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        空闲
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        已禁用
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(k.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {k.in_use && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary hover:text-primary/80"
                          title="强制释放锁（任务已终止但锁未释放时使用）"
                          onClick={() => handleRelease(k.id)}
                          disabled={actionId === k.id}
                        >
                          {actionId === k.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Unlock className="h-4 w-4" />}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title={k.is_active ? '禁用' : '启用'}
                        onClick={() => handleToggle(k.id)}
                        disabled={actionId === k.id || k.in_use}
                      >
                        {actionId === k.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <PowerOff className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="删除"
                        onClick={() => handleDelete(k.id)}
                        disabled={actionId === k.id || k.in_use}
                      >
                        {actionId === k.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(''); setForm({ provider: 'aipipe', purpose: 'both', api_key: '', label: '' }) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加系统 Key</DialogTitle>
            <DialogDescription>Key 将加密存储，添加后立即加入可用池。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="provider">提供商</Label>
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
              <Label htmlFor="purpose">用途</Label>
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
                placeholder="例：主力写稿、备用对话"
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
