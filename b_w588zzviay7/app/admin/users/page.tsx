import { UserTable } from "@/components/admin/user-table"
import { getAllUsers } from "@/lib/mock-data"

export default function AdminUsersPage() {
  const users = getAllUsers()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">用户管理</h1>
        <p className="text-sm text-muted-foreground">
          管理系统用户，查看用户任务和状态
        </p>
      </div>

      <UserTable users={users} />
    </div>
  )
}
