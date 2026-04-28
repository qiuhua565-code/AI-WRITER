import { notFound } from "next/navigation"
import { ArticleEditor } from "@/components/dashboard/article-editor"
import { getTask } from "@/lib/mock-data"

interface ArticlePageProps {
  params: Promise<{ id: string }>
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { id } = await params
  const task = getTask(id)

  if (!task || !task.content) {
    notFound()
  }

  return <ArticleEditor task={task} />
}
