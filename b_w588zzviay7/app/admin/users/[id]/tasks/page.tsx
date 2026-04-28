import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, User as UserIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { TaskCard } from "@/components/dashboard/task-card"
import { getUser, getUserTasks } from "@/lib/mock-data"
import { Empty } from "@/components/ui/empty"

interface UserTasksPageProps {
  params: Promise<{ id: string }>
}

export default async function UserTasksPage({ params }: UserTasksPageProps) {
  const { id } = await params
  const user = getUser(id)

  if (!user) {
    notFound()
  }

  const tasks = getUserTasks(user.id)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">用户任务</h1>
          <p className="text-sm text-muted-foreground">查看该用户的所有写作任务</p>
        </div>
      </div>

      {/* User Info Card */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback>
                <UserIcon className="h-6 w-6" />
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-lg font-semibold">{user.name}</h2>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <div className="ml-auto text-right">
              <div className="text-2xl font-bold">{tasks.length}</div>
              <p className="text-sm text-muted-foreground">总任务数</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tasks Grid */}
      {tasks.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      ) : (
        <Empty className="py-12">
          <Empty.Icon />
          <Empty.Title>暂无任务</Empty.Title>
          <Empty.Description>该用户还没有创建任何写作任务</Empty.Description>
        </Empty>
      )}
    </div>
  )
}
