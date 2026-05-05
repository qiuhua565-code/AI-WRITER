"use client"

import { useState, useCallback } from "react"
import {
  Search,
  MoreHorizontal,
  UserX,
  UserCheck,
  UserPlus,
  KeyRound,
  Trash2,
  Loader2,
  Plus,
  Lock,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { adminApi, adminUserKeysApi, AdminUser, ApiKey } from "@/lib/api"

interface UserTableProps {
  users: AdminUser[]
  onRefresh: () => void
}

const PROVIDERS = [
  { value: "claude", label: "Claude" },
  { value: "aipipe", label: "AIPipe" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "gemini", label: "Gemini" },
  { value: "custom", label: "自定义" },
]

const PURPOSES = [
  { value: "both", label: "通用" },
  { value: "chat", label: "对话" },
  { value: "generate", label: "批量生成" },
]

type InitialKeyRow = {
  provider: string
  purpose: string
  api_key: string
  label: string
}

function emptyInitialKeyRow(): InitialKeyRow {
  return { provider: "claude", purpose: "both", api_key: "", label: "" }
}

export function UserTable({ users, onRefresh }: UserTableProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [dialogAction, setDialogAction] = useState<"enable" | "disable" | "reset" | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newUser, setNewUser] = useState({ email: "", password: "", name: "", role: "user" })
  const [initialKeyRows, setInitialKeyRows] = useState<InitialKeyRow[]>([])
  const [newPassword, setNewPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const [keyPoolOpen, setKeyPoolOpen] = useState(false)
  const [keyPoolUser, setKeyPoolUser] = useState<AdminUser | null>(null)
  const [keyPoolKeys, setKeyPoolKeys] = useState<ApiKey[]>([])
  const [keyPoolLoading, setKeyPoolLoading] = useState(false)
  const [keyPoolSubmitting, setKeyPoolSubmitting] = useState(false)
  const [keyPoolForm, setKeyPoolForm] = useState(emptyInitialKeyRow)
  const [keyPoolError, setKeyPoolError] = useState("")
  const [deletingKeyId, setDeletingKeyId] = useState<number | null>(null)

  const filtered = users.filter(
    (u) =>
      u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" })

  const openAction = (user: AdminUser, action: "enable" | "disable" | "reset") => {
    setSelectedUser(user)
    setDialogAction(action)
    setError("")
    setNewPassword("")
  }

  const loadKeyPool = useCallback(async (user: AdminUser) => {
    setKeyPoolLoading(true)
    setKeyPoolError("")
    try {
      const list = await adminUserKeysApi.list(user.id)
      setKeyPoolKeys(list)
    } catch (e: unknown) {
      setKeyPoolError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setKeyPoolLoading(false)
    }
  }, [])

  const openKeyPool = (user: AdminUser) => {
    setKeyPoolUser(user)
    setKeyPoolForm(emptyInitialKeyRow())
    setKeyPoolOpen(true)
    void loadKeyPool(user)
  }

  const handleKeyPoolAdd = async () => {
    if (!keyPoolUser || !keyPoolForm.api_key.trim()) {
      setKeyPoolError("请输入 API Key")
      return
    }
    setKeyPoolSubmitting(true)
    setKeyPoolError("")
    try {
      await adminUserKeysApi.add(keyPoolUser.id, {
        provider: keyPoolForm.provider,
        purpose: keyPoolForm.purpose,
        api_key: keyPoolForm.api_key.trim(),
        label: keyPoolForm.label.trim(),
      })
      setKeyPoolForm(emptyInitialKeyRow())
      await loadKeyPool(keyPoolUser)
      onRefresh()
    } catch (e: unknown) {
      setKeyPoolError(e instanceof Error ? e.message : "添加失败")
    } finally {
      setKeyPoolSubmitting(false)
    }
  }

  const handleKeyPoolDelete = async (keyId: number) => {
    if (!keyPoolUser) return
    setDeletingKeyId(keyId)
    setKeyPoolError("")
    try {
      await adminUserKeysApi.delete(keyPoolUser.id, keyId)
      await loadKeyPool(keyPoolUser)
      onRefresh()
    } catch (e: unknown) {
      setKeyPoolError(e instanceof Error ? e.message : "删除失败")
    } finally {
      setDeletingKeyId(null)
    }
  }

  const handleStatusChange = async () => {
    if (!selectedUser) return
    setSubmitting(true)
    setError("")
    try {
      if (dialogAction === "reset") {
        if (newPassword.length < 6) {
          setError("密码至少6位")
          setSubmitting(false)
          return
        }
        await adminApi.updateUser(selectedUser.id, { password: newPassword })
      } else {
        await adminApi.updateUser(selectedUser.id, {
          status: dialogAction === "disable" ? "disabled" : "active",
        })
      }
      onRefresh()
      setDialogAction(null)
      setSelectedUser(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "操作失败")
    } finally {
      setSubmitting(false)
    }
  }

  const resetCreateForm = () => {
    setNewUser({ email: "", password: "", name: "", role: "user" })
    setInitialKeyRows([])
    setError("")
  }

  const handleCreate = async () => {
    if (!newUser.email || !newUser.password || !newUser.name) {
      setError("请填写所有字段")
      return
    }
    if (newUser.password.length < 6) {
      setError("密码至少6位")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const initial_api_keys = initialKeyRows
        .map((r) => ({
          provider: r.provider,
          purpose: r.purpose,
          api_key: r.api_key.trim(),
          label: r.label.trim(),
        }))
        .filter((r) => r.api_key.length >= 10)

      await adminApi.createUser({
        email: newUser.email,
        password: newUser.password,
        name: newUser.name,
        role: newUser.role,
        ...(initial_api_keys.length ? { initial_api_keys } : {}),
      })
      onRefresh()
      setCreateOpen(false)
      resetCreateForm()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索用户名或邮箱..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          onClick={() => {
            setCreateOpen(true)
            setError("")
            resetCreateForm()
          }}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          新建用户
        </Button>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>个人 Key 池</TableHead>
              <TableHead>日限额</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback>{(user.name || user.email)[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-sm text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role === "admin" ? "管理员" : "普通用户"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        user.status === "active"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {user.status === "active" ? "活跃" : "已禁用"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      <span className="font-medium text-foreground">
                        {user.api_keys_count ?? 0} 条
                      </span>
                      {user.llm_api_key_hint ? (
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          最新 Claude：{user.llm_api_key_hint}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-muted-foreground">未绑 Claude 兼容字段</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {user.daily_task_limit ?? "不限"}
                  </TableCell>
                  <TableCell>{formatDate(user.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openKeyPool(user)}>
                          <KeyRound className="mr-2 h-4 w-4" />
                          管理个人 Key 池
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => openAction(user, "reset")}>
                          <Lock className="mr-2 h-4 w-4" />
                          重置密码
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {user.status === "active" ? (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => openAction(user, "disable")}
                          >
                            <UserX className="mr-2 h-4 w-4" />
                            禁用账户
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => openAction(user, "enable")}>
                            <UserCheck className="mr-2 h-4 w-4" />
                            启用账户
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  没有找到匹配的用户
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={!!dialogAction}
        onOpenChange={() => {
          setDialogAction(null)
          setNewPassword("")
          setError("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogAction === "disable"
                ? "禁用账户"
                : dialogAction === "enable"
                  ? "启用账户"
                  : "重置密码"}
            </DialogTitle>
            <DialogDescription>
              {dialogAction === "disable"
                ? `确定要禁用 "${selectedUser?.name || selectedUser?.email}" 的账户吗？禁用后该用户将无法登录。`
                : dialogAction === "enable"
                  ? `确定要启用 "${selectedUser?.name || selectedUser?.email}" 的账户吗？`
                  : `为 "${selectedUser?.name || selectedUser?.email}" 设置新密码。`}
            </DialogDescription>
          </DialogHeader>
          {dialogAction === "reset" && (
            <div className="space-y-2 py-2">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="至少6位"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogAction(null)
                setNewPassword("")
                setError("")
              }}
            >
              取消
            </Button>
            <Button
              variant={dialogAction === "disable" ? "destructive" : "default"}
              onClick={handleStatusChange}
              disabled={submitting}
            >
              {submitting ? "处理中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={keyPoolOpen}
        onOpenChange={(o) => {
          setKeyPoolOpen(o)
          if (!o) {
            setKeyPoolUser(null)
            setKeyPoolKeys([])
            setKeyPoolError("")
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-hidden flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>个人 Key 池</DialogTitle>
            <DialogDescription>
              {keyPoolUser
                ? `用户 ${keyPoolUser.email} — 属于该账号的多条 Key；任务/对话会随机选用其中符合条件的 Key。与「系统 Key 池」无关。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
            {keyPoolError && (
              <p className="text-sm text-destructive">{keyPoolError}</p>
            )}
            <ScrollArea className="h-[min(40vh,280px)] rounded-md border">
              {keyPoolLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : keyPoolKeys.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  暂无 Key，可在下方添加
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[72px]">提供商</TableHead>
                      <TableHead className="w-[56px]">用途</TableHead>
                      <TableHead>掩码</TableHead>
                      <TableHead className="w-16 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keyPoolKeys.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="text-xs">{k.provider}</TableCell>
                        <TableCell className="text-xs">{k.purpose}</TableCell>
                        <TableCell className="font-mono text-[11px]">{k.key_hint}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            disabled={deletingKeyId === k.id}
                            onClick={() => void handleKeyPoolDelete(k.id)}
                          >
                            {deletingKeyId === k.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>

            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">添加一条 Key</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">提供商</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={keyPoolForm.provider}
                    onChange={(e) =>
                      setKeyPoolForm((f) => ({ ...f, provider: e.target.value }))
                    }
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">用途</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={keyPoolForm.purpose}
                    onChange={(e) =>
                      setKeyPoolForm((f) => ({ ...f, purpose: e.target.value }))
                    }
                  >
                    {PURPOSES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">API Key</Label>
                <Input
                  className="font-mono text-sm"
                  placeholder="sk-..."
                  value={keyPoolForm.api_key}
                  onChange={(e) =>
                    setKeyPoolForm((f) => ({ ...f, api_key: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">备注（可选）</Label>
                <Input
                  value={keyPoolForm.label}
                  onChange={(e) =>
                    setKeyPoolForm((f) => ({ ...f, label: e.target.value }))
                  }
                />
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={keyPoolSubmitting}
                onClick={() => void handleKeyPoolAdd()}
              >
                {keyPoolSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                添加到该用户
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o)
          if (!o) resetCreateForm()
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription>
              创建账号后可在此预置多条个人 Key；用户也可在设置页自行管理同一 Key 池。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="c-name">姓名</Label>
              <Input
                id="c-name"
                placeholder="真实姓名或昵称"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-email">邮箱</Label>
              <Input
                id="c-email"
                type="email"
                placeholder="user@example.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-password">初始密码</Label>
              <Input
                id="c-password"
                type="password"
                placeholder="至少6位"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-role">角色</Label>
              <select
                id="c-role"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>

            <div className="rounded-lg border border-dashed p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-sm">预置个人 Key（可选，可多条）</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setInitialKeyRows((rows) => [...rows, emptyInitialKeyRow()])}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  添加一行
                </Button>
              </div>
              {initialKeyRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  无预置则用户首次需在「设置 → API Key」自行添加；也可创建后再用「管理个人 Key 池」录入。
                </p>
              ) : (
                <div className="space-y-3">
                  {initialKeyRows.map((row, idx) => (
                    <div
                      key={idx}
                      className="space-y-2 rounded-md border bg-muted/20 p-2"
                    >
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive"
                          onClick={() =>
                            setInitialKeyRows((rows) => rows.filter((_, i) => i !== idx))
                          }
                        >
                          移除此行
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                          value={row.provider}
                          onChange={(e) => {
                            const v = e.target.value
                            setInitialKeyRows((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, provider: v } : r))
                            )
                          }}
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                          value={row.purpose}
                          onChange={(e) => {
                            const v = e.target.value
                            setInitialKeyRows((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, purpose: v } : r))
                            )
                          }}
                        >
                          {PURPOSES.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Input
                        className="font-mono text-xs"
                        placeholder="API Key（至少10字符）"
                        value={row.api_key}
                        onChange={(e) => {
                          const v = e.target.value
                          setInitialKeyRows((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, api_key: v } : r))
                          )
                        }}
                      />
                      <Input
                        className="text-xs"
                        placeholder="备注（可选）"
                        value={row.label}
                        onChange={(e) => {
                          const v = e.target.value
                          setInitialKeyRows((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, label: v } : r))
                          )
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? "创建中..." : "创建账户"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
