# 11 前端模块设计

## 11.1 技术栈

| 层 | 技术 | 备注 |
|---|---|---|
| 框架 | Next.js 16 (App Router) | 复用 V0 基础 |
| 渲染 | React 19 + RSC + Client Components | RSC 用于初始渲染，Client 处理交互 |
| 样式 | Tailwind CSS 4 | V0 已用 |
| UI 库 | shadcn/ui (Radix UI 封装) | V0 已用 |
| 富文本 | TipTap v2 + tiptap-markdown | 替换 V0 的 textarea |
| 状态管理 | Zustand + TanStack Query | 客户端状态 + 服务器状态 |
| 表单 | React Hook Form + Zod | V0 已引入 |
| HTTP | fetch API + 自封装 client | 简单不引入 axios |
| SSE | @microsoft/fetch-event-source | 比原生 EventSource 更灵活 |
| 路由守卫 | Next.js middleware + JWT | 中间件层做鉴权 |
| 国际化 | （MVP 不做）| v2 接 next-intl |
| 测试 | Vitest + React Testing Library | 关键组件单测 |

## 11.2 目录结构

```
front/
├── app/                            # Next.js App Router
│   ├── layout.tsx                  # 根布局（providers）
│   ├── page.tsx                    # 着陆页
│   ├── login/
│   │   └── page.tsx
│   ├── (authed)/                   # 鉴权路由组
│   │   ├── layout.tsx              # 含侧边栏 + 顶栏
│   │   ├── dashboard/
│   │   │   ├── page.tsx            # 任务列表
│   │   │   ├── new/
│   │   │   │   └── page.tsx        # 批量提交
│   │   │   └── article/[id]/
│   │   │       ├── page.tsx        # 文章编辑/审核（review）
│   │   │       └── outline/
│   │   │           └── page.tsx    # 大纲审核
│   │   ├── settings/
│   │   │   ├── page.tsx            # 个人信息
│   │   │   ├── llm-key/
│   │   │   │   └── page.tsx        # LLM Key 配置
│   │   │   └── password/
│   │   │       └── page.tsx
│   │   └── admin/                  # 管理员
│   │       ├── layout.tsx          # 仅 admin 可见
│   │       ├── page.tsx            # 概览
│   │       ├── users/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── queue/
│   │       │   └── page.tsx        # 队列监控
│   │       ├── usage/
│   │       │   └── page.tsx        # token 用量
│   │       └── tasks/
│   │           └── page.tsx        # 全局任务监控
│   ├── api/                        # Next.js API routes（仅做 BFF 转发）
│   │   └── proxy/[...path]/route.ts # 把 /api/v1/* 转发到 FastAPI
│   └── globals.css
│
├── components/
│   ├── ui/                         # shadcn 组件（V0 已有）
│   ├── editor/
│   │   ├── ArticleEditor.tsx       # 主编辑器组件
│   │   ├── ChapterBlock.tsx        # 章节块自定义节点
│   │   ├── extensions/
│   │   │   ├── chapterBlock.ts
│   │   │   └── markdownIO.ts
│   │   ├── DiffPreview.tsx
│   │   └── VersionHistory.tsx
│   ├── streaming/
│   │   ├── StreamingMarkdown.tsx
│   │   └── StreamingTextArea.tsx
│   ├── task/
│   │   ├── TaskCard.tsx            # V0 改造
│   │   ├── TaskList.tsx
│   │   ├── TaskFilter.tsx
│   │   ├── BatchSubmitForm.tsx
│   │   ├── ProgressBar.tsx
│   │   └── StatusBadge.tsx
│   ├── ai/
│   │   ├── AIChatPanel.tsx         # 右栏对话面板
│   │   ├── AIEditPanel.tsx         # 选中文字 + 指令
│   │   ├── ConsistencyCheckModal.tsx
│   │   └── ActionProposalCard.tsx  # AI 提议卡片
│   ├── outline/
│   │   ├── OutlineReviewer.tsx
│   │   └── OutlineTree.tsx
│   ├── admin/
│   │   ├── UserTable.tsx           # V0 已有
│   │   ├── QueueDashboard.tsx
│   │   └── UsageStats.tsx
│   └── layout/
│       ├── Sidebar.tsx
│       └── TopNav.tsx
│
├── lib/
│   ├── api/
│   │   ├── client.ts               # fetch 封装
│   │   ├── tasks.ts                # 任务相关 API
│   │   ├── users.ts
│   │   ├── admin.ts
│   │   └── types.ts                # 从 OpenAPI 生成
│   ├── sse/
│   │   ├── taskStream.ts           # 任务详情 SSE
│   │   └── tasksListStream.ts      # 列表 SSE
│   ├── auth/
│   │   ├── token.ts
│   │   └── middleware.ts
│   ├── stores/
│   │   ├── authStore.ts
│   │   ├── taskListStore.ts
│   │   └── editorStore.ts
│   ├── hooks/
│   │   ├── useStreamingText.ts
│   │   ├── useStickyBottom.ts
│   │   ├── useTaskStream.ts
│   │   └── useDebouncedCallback.ts
│   ├── utils/
│   │   ├── markdown.ts
│   │   ├── format.ts
│   │   └── crypto.ts
│   └── types.ts
│
├── hooks/                           # （V0 已有目录）通用 hooks
├── public/
├── styles/
└── package.json
```

## 11.3 关键页面设计

### 11.3.1 着陆页 `/`

V0 已实现，保留即可。仅做小调整：

- 未登录时按钮跳 `/login`
- 已登录时按钮跳 `/dashboard`

### 11.3.2 登录页 `/login`

V0 没有，新增。简单实现：

```tsx
// app/login/page.tsx
'use client';

export default function LoginPage() {
  const form = useForm({ resolver: zodResolver(LoginSchema) });
  const router = useRouter();
  
  async function onSubmit(values) {
    const res = await api.auth.login(values);
    setToken(res.access_token);
    router.push('/dashboard');
  }
  
  return (
    <div className="min-h-screen grid place-items-center">
      <Card className="w-96">
        <CardHeader>
          <CardTitle>登录 AI-StoryFlow</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FormField name="email" .../>
              <FormField name="password" .../>
              <Button type="submit">登录</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 11.3.3 任务列表 `/dashboard`

**V0 已有，主要改造：**

1. 接真 API 替换 mock-data
2. 接 SSE 实时更新进度（参见下文 11.4）
3. 卡片增加：当前章节、已用时间、模型、操作按钮（暂停/继续/取消）
4. 顶部增加"汇总条"：进行中 X / 待审核 Y / 今日完成 Z
5. 状态筛选增加 `paused`、`failed`、`cancelled`

```tsx
// 主要数据流
function DashboardPage() {
  const { data, refetch } = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => api.tasks.list(filters),
  });
  
  // 订阅实时更新
  useTaskListStream({
    onTaskUpdate: (update) => {
      queryClient.setQueryData(['tasks', filters], (old) => 
        updateTaskInList(old, update)
      );
    },
  });
  
  return (
    <>
      <SummaryBar tasks={data?.items} />
      <TaskFilter ... />
      <TaskList tasks={data?.items} />
    </>
  );
}
```

### 11.3.4 批量提交 `/dashboard/new`

**V0 已有，改造：**

1. 标题列表保留，但增加"任务参数"区域：
   - 题材选择（玄幻/武侠/都市/科幻/其他）
   - 目标字数滑块（5000 - 30000）
   - 风格描述（可选 textarea）
   - 写作模型选择（默认 claude-3.5-sonnet）
   - 是否需审大纲（switch）
2. 支持从 .txt / .csv 文件导入标题
3. 提交前显示"将消耗约 X 万 tokens"估算

```tsx
function BatchSubmitForm() {
  const [titles, setTitles] = useState<string[]>([]);
  const [config, setConfig] = useState<TaskConfig>(DEFAULT_CONFIG);
  
  async function handleSubmit() {
    const result = await api.tasks.createBatch({ titles, config });
    toast.success(`已提交 ${result.queued_count} 个任务`);
    router.push('/dashboard');
  }
  
  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <h2>标题列表</h2>
        <TextareaWithImport ... />
        <FileImport accept=".txt,.csv" onParse={setTitles} />
      </div>
      <div>
        <h2>任务参数</h2>
        <ConfigForm value={config} onChange={setConfig} />
        <EstimatedCost titles={titles} config={config} />
      </div>
      <Button onClick={handleSubmit}>提交 {titles.length} 个任务</Button>
    </div>
  );
}
```

### 11.3.5 大纲审核 `/dashboard/article/[id]/outline`

V0 没有，新增。当任务状态为 `outline_review` 时引导到这里。

```
┌─────────────────────────────────────────────────────────────┐
│ ← 返回    《星际迷途》  [● 待审大纲]      [重新生成大纲]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────┐  ┌─────────────────────────────────┐ │
│  │ 大纲结构          │  │ 章节详情                         │ │
│  │                   │  │                                 │ │
│  │ ▼ 故事信息        │  │ 第3章 雨夜惊变                  │ │
│  │   主题: ...       │  │                                 │ │
│  │   世界观: ...     │  │ 章节标题: [可编辑]              │ │
│  │   主角: ...       │  │                                 │ │
│  │                   │  │ 章节梗概:                       │ │
│  │ ▼ 章节列表 (6)    │  │ ┌─────────────────────────────┐ │ │
│  │   1. 开篇         │  │ │ [可编辑 textarea]           │ │ │
│  │   2. 相遇         │  │ │                             │ │ │
│  │ → 3. 雨夜惊变 ⚙   │  │ └─────────────────────────────┘ │ │
│  │   4. 决战         │  │                                 │ │
│  │   5. 转折         │  │ 关键事件:                       │ │
│  │   6. 结局         │  │   • [可编辑]                    │ │
│  │                   │  │   • ...                         │ │
│  │ [+ 添加章节]      │  │                                 │ │
│  │                   │  │ 目标字数: [____]                │ │
│  └───────────────────┘  └─────────────────────────────────┘ │
│                                                             │
│              [取消]  [保存修改]  [通过大纲，开始生成正文]    │
└─────────────────────────────────────────────────────────────┘
```

### 11.3.6 文章编辑/审核 `/dashboard/article/[id]`

**V0 已有但要大改造**。详见 [06-review-and-edit.md](./06-review-and-edit.md)。

核心组件：

```tsx
function ArticleEditorPage({ params }) {
  const { id } = params;
  const { data } = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.tasks.getFull(id),
  });
  
  const editor = useEditor({
    extensions: [StarterKit, ChapterBlock, MarkdownIO, ...],
    content: buildEditorContent(data),
    editable: data?.task.status === 'review' || data?.task.status === 'approved',
  });
  
  // 订阅流式更新
  useTaskStream(id, {
    onToken: ({ segmentId, content }) => {
      // 流式期：定位到对应章节块，追加内容
      appendToChapterBlock(editor, segmentId, content);
    },
    onSegmentStatus: (data) => { ... },
    onTaskStatus: (data) => { ... },
  });
  
  return (
    <ThreeColumnLayout
      left={<ExecutionLogPanel taskId={id} />}
      center={<EditorContent editor={editor} />}
      right={<AISidePanel taskId={id} editor={editor} />}
      footerActions={<ReviewActions task={data?.task} />}
    />
  );
}
```

### 11.3.7 个人设置 `/settings/llm-key`

V0 没有，新增。详见 [08-llm-and-keys.md §8.2.3](./08-llm-and-keys.md)。

### 11.3.8 管理后台

V0 已有 `/admin/users`、`/admin/users/[id]/tasks`，改造：

- 接真 API
- 新增 `/admin/queue`（队列监控）
- 新增 `/admin/usage`（token 用量）
- 新增 `/admin/tasks`（全局任务监控，可强制取消）

## 11.4 实时数据流（核心）

### 11.4.1 任务列表实时更新

```typescript
// hooks/useTaskListStream.ts
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export function useTaskListStream() {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    const ctrl = new AbortController();
    
    fetchEventSource('/api/v1/tasks/stream', {
      method: 'GET',
      headers: { Authorization: `Bearer ${getToken()}` },
      signal: ctrl.signal,
      onmessage(ev) {
        const data = JSON.parse(ev.data);
        if (ev.event === 'task_update') {
          queryClient.setQueryData(['tasks'], (old) => 
            updateTaskInList(old, data)
          );
        }
      },
      onerror(err) {
        console.warn('[task list stream]', err);
        // fetchEventSource 默认会重试
        throw err;
      },
    });
    
    return () => ctrl.abort();
  }, []);
}
```

### 11.4.2 任务详情 / 编辑器实时流

```typescript
// hooks/useTaskStream.ts
export function useTaskStream(taskId: number, callbacks: StreamCallbacks) {
  useEffect(() => {
    const ctrl = new AbortController();
    let lastEventId = '';
    
    fetchEventSource(`/api/v1/tasks/${taskId}/stream`, {
      method: 'GET',
      headers: { 
        Authorization: `Bearer ${getToken()}`,
        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      },
      signal: ctrl.signal,
      
      onmessage(ev) {
        lastEventId = ev.id;
        const data = JSON.parse(ev.data);
        
        switch (ev.event) {
          case 'token':
          case 'outline_token':
            callbacks.onToken?.(data);
            break;
          case 'segment_status':
            callbacks.onSegmentStatus?.(data);
            break;
          case 'task_status':
            callbacks.onTaskStatus?.(data);
            break;
          case 'progress':
            callbacks.onProgress?.(data);
            break;
          case 'done':
            callbacks.onDone?.(data);
            ctrl.abort();
            break;
          case 'error':
            callbacks.onError?.(data);
            break;
        }
      },
      
      onerror(err) {
        callbacks.onError?.({ message: err.message, recoverable: true });
        throw err;  // 让 fetchEventSource 退避重连
      },
    });
    
    return () => ctrl.abort();
  }, [taskId]);
}
```

### 11.4.3 编辑器流式追加（关键）

```typescript
function appendToChapterBlock(editor: Editor, segmentId: string, content: string) {
  const tr = editor.state.tr;
  
  // 找到对应章节块的位置
  let chapterPos: number | null = null;
  let chapterEndPos: number | null = null;
  
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'chapter' && node.attrs.segmentId === Number(segmentId)) {
      chapterPos = pos;
      chapterEndPos = pos + node.nodeSize - 1;
      return false;
    }
  });
  
  if (chapterEndPos == null) {
    // 章节块还没创建（首次 token），创建一个空块
    return;
  }
  
  // 在章节块末尾追加文本
  tr.insertText(content, chapterEndPos - 1);
  editor.view.dispatch(tr);
}
```

由于这种 dispatch 频繁会卡，必须配合 [05-streaming.md §5.4.2](./05-streaming.md) 的 rAF 批合并：

```typescript
const pendingByChapter = useRef<Map<string, string[]>>(new Map());
const rafScheduled = useRef(false);

function appendTokenBatched(segmentId: string, content: string) {
  const arr = pendingByChapter.current.get(segmentId) ?? [];
  arr.push(content);
  pendingByChapter.current.set(segmentId, arr);
  
  if (!rafScheduled.current) {
    rafScheduled.current = true;
    requestAnimationFrame(() => {
      rafScheduled.current = false;
      const tr = editor.state.tr;
      for (const [segId, tokens] of pendingByChapter.current) {
        // 批量插入
        const text = tokens.join('');
        // ... 找位置 + insertText ...
      }
      pendingByChapter.current.clear();
      editor.view.dispatch(tr);
    });
  }
}
```

## 11.5 状态管理

### 11.5.1 全局状态（Zustand）

```typescript
// stores/authStore.ts
interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    set({ user, token });
  },
  clearAuth: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },
}));
```

### 11.5.2 服务器状态（TanStack Query）

```typescript
// 任务列表
const { data, isLoading } = useQuery({
  queryKey: ['tasks', filters],
  queryFn: () => api.tasks.list(filters),
  staleTime: 30_000,
});

// 任务详情
const { data } = useQuery({
  queryKey: ['task', id, 'full'],
  queryFn: () => api.tasks.getFull(id),
});

// 提交任务
const mutation = useMutation({
  mutationFn: api.tasks.createBatch,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  },
});
```

## 11.6 鉴权与路由守卫

### 11.6.1 Next.js Middleware

```typescript
// middleware.ts
import { NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;
  
  // 受保护路由
  const protected_paths = ['/dashboard', '/settings', '/admin'];
  if (protected_paths.some(p => pathname.startsWith(p)) && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  // admin 路由
  if (pathname.startsWith('/admin') && token) {
    // 简单解析 JWT 看 role（生产应在后端校验）
    const payload = parseJWT(token);
    if (payload?.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*', '/admin/:path*'],
};
```

### 11.6.2 API Client 自动带 Token

```typescript
// lib/api/client.ts
async function apiFetch(path: string, init?: RequestInit) {
  const token = useAuthStore.getState().token;
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  
  if (res.status === 401) {
    useAuthStore.getState().clearAuth();
    window.location.href = '/login';
    return Promise.reject(new Error('未授权'));
  }
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new ApiError(error.detail || res.statusText, res.status, error.code);
  }
  
  return res.json();
}
```

### 11.6.3 BFF 转发（可选）

如果希望前端 `/api/v1/*` 由 Next.js 转发到 FastAPI（开发期方便），用 rewrites：

```javascript
// next.config.mjs
export default {
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${process.env.BACKEND_URL}/api/v1/:path*` }
    ];
  },
};
```

或写一个 proxy route：`app/api/proxy/[...path]/route.ts`，做请求转发。

## 11.7 性能优化清单

| 项 | 措施 |
|---|---|
| 长文章渲染 | TipTap 单实例可承受 1-2 万字，无需虚拟化 |
| 流式 token 渲染 | rAF 批合并，每帧最多 1 次 dispatch |
| 列表大数据 | 服务端分页，单页最多 50 条 |
| 图片资源 | next/image 自动优化 |
| 路由切换 | App Router 自动 prefetch |
| TanStack Query | staleTime 控制重复请求 |
| SSE 重连 | fetchEventSource 自带退避 |
| Bundle 体积 | 动态 import 大组件（编辑器、admin 页面）|

```typescript
// 动态导入大组件
const ArticleEditor = dynamic(() => import('@/components/editor/ArticleEditor'), {
  loading: () => <Spinner />,
  ssr: false,
});
```

## 11.8 V0 改造工作量估算

| 文件/模块 | 当前状态 | 改造量 | 工时估 |
|---|---|---|---|
| `app/page.tsx` 着陆页 | 完整 | 微调 | 0.5h |
| `app/login/page.tsx` | 缺失 | 新建 | 4h |
| `app/dashboard/page.tsx` | 用 mock | 接 API + SSE | 8h |
| `app/dashboard/new/page.tsx` | 仅标题 | 加配置区 + 文件导入 | 8h |
| `app/dashboard/article/[id]/page.tsx` | textarea | 改为 TipTap + 三栏 + AI | 24h |
| `app/dashboard/article/[id]/outline/page.tsx` | 缺失 | 新建 | 12h |
| `app/settings/*` | 缺失 | 新建（profile + key + password）| 12h |
| `app/admin/*` 完善 | 部分 | 队列、usage、强制操作 | 16h |
| 编辑器 ChapterBlock 节点 | 缺失 | 新建 | 8h |
| AI 三种修改面板 | 缺失 | 新建 | 16h |
| 一致性检查 modal | 缺失 | 新建 | 6h |
| 版本历史侧栏 | 缺失 | 新建 | 6h |
| Diff 预览组件 | 缺失 | 新建 | 4h |
| SSE hooks | 缺失 | 新建 | 8h |
| 鉴权与路由守卫 | 缺失 | 新建 | 6h |
| API client | 缺失 | 新建 | 4h |
| 流式渲染优化 | 缺失 | rAF + 批量 | 8h |
| **合计** | | | **~150h ≈ 4 周（1人）** |
