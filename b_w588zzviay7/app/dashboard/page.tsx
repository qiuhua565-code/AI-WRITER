import { TaskList } from "@/components/dashboard/task-list"
import { getCurrentUser, getUserTasks } from "@/lib/mock-data"

export default function DashboardPage() {
  const currentUser = getCurrentUser()
  const tasks = getUserTasks(currentUser.id)

  return <TaskList tasks={tasks} />
}
