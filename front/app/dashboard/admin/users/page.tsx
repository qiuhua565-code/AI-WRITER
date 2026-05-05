"use client"

import { useEffect, useState, useCallback } from "react"
import { UserTable } from "@/components/admin/user-table"
import { adminApi, AdminUser } from "@/lib/api"

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    adminApi.listUsers()
      .then((data) => setUsers(data.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">用户管理</h1>
        <p className="text-sm text-muted-foreground">管理系统用户，创建账户和修改状态</p>
      </div>
      {loading ? (
        <div className="py-12 text-center text-muted-foreground">加载中...</div>
      ) : (
        <UserTable users={users} onRefresh={load} />
      )}
    </div>
  )
}
