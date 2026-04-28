import { Users, FileText, CheckCircle, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAllUsers, mockTasks } from "@/lib/mock-data"

export default function AdminDashboardPage() {
  const users = getAllUsers()
  const totalTasks = mockTasks.length
  const completedTasks = mockTasks.filter((t) => t.status === "approved").length
  const pendingReview = mockTasks.filter((t) => t.status === "review").length

  const stats = [
    {
      title: "总用户数",
      value: users.length,
      description: `${users.filter((u) => u.status === "active").length} 个活跃`,
      icon: Users,
      color: "text-primary",
    },
    {
      title: "总任务数",
      value: totalTasks,
      description: "所有用户任务",
      icon: FileText,
      color: "text-muted-foreground",
    },
    {
      title: "已完成",
      value: completedTasks,
      description: `${Math.round((completedTasks / totalTasks) * 100)}% 完成率`,
      icon: CheckCircle,
      color: "text-emerald-600",
    },
    {
      title: "待审核",
      value: pendingReview,
      description: "需要用户审核",
      icon: Clock,
      color: "text-amber-600",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">管理仪表盘</h1>
        <p className="text-sm text-muted-foreground">系统概览和统计数据</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
