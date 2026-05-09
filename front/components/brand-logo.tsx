import { cn } from "@/lib/utils"
import { BRAND_NAME } from "@/lib/brand"

/** 简约几何标：三段上升条，示意增长/排单，无繁复图形 */
export function BrandMark({
  className,
  size = 36,
  title = BRAND_NAME,
}: {
  className?: string
  size?: number
  title?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 text-primary", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      <rect width="40" height="40" rx="10" fill="currentColor" />
      <path
        d="M11 26V14M19 26V10M27 26v-8"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
