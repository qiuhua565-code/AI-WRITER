# 06 审核与编辑机制

定义文章生成完毕后，用户在审核期如何查看、编辑、与 AI 协作修改内容。

## 6.1 审核页布局

```
┌────────────────────────────────────────────────────────────────────┐
│ ← 返回  《星际迷途》  [● 待审核 12,345字]    [导出Word] [审核通过] │
├──────────────┬───────────────────────────────────────┬─────────────┤
│              │                                       │             │
│  执行记录    │  📖 第一章 雨夜惊变                   │  💬 AI对话  │
│  (默认折叠)  │                                       │             │
│              │      他望着远处的灯火，手中的剑       │  审核期跟AI │
│  ▼ 系统      │      在夜色中泛着冷光... [选中]       │  讨论修改   │
│  ▼ 用户      │                                       │             │
│  ▼ AI助手    │  📖 第二章 江湖故人                   │  ┌─────────┐│
│  ▼ AI助手    │                                       │  │ 已选中:  ││
│              │      清晨的薄雾尚未散去，他披衣       │  │"他望着..." ││
│  详细对话    │      起身，推开窗见到院中梅花...      │  │ 共15字   ││
│  日志可下载  │                                       │  └─────────┘│
│              │  📖 第三章 血染长安                   │             │
│              │                                       │  快捷指令:  │
│              │      ...                              │  [润色][扩展]│
│              │                                       │  [精简][修正]│
│              │  [一致性检查] [历史版本] [全文重写]   │             │
│              │                                       │  自定义:    │
│              │                                       │  ┌─────────┐│
│              │                                       │  │ 输入框   ││
│              │                                       │  └─────────┘│
│              │                                       │  [发送]      │
└──────────────┴───────────────────────────────────────┴─────────────┘
   左栏：320px       中栏：flex-1（最大 900px 居中）       右栏：360px
```

## 6.2 编辑器选型与章节块

### 6.2.1 TipTap

用 [TipTap v2](https://tiptap.dev/) 作为富文本编辑器：

- 基于 ProseMirror，业界 SOTA
- 支持 Markdown 输入输出（用 `tiptap-markdown` 扩展）
- 自定义节点能力强，能给"章节块"打 `data-segment-id`
- 与 React 集成完善（`@tiptap/react`）

### 6.2.2 章节块自定义节点

每章是一个独立的"块"，DOM 上带 `data-segment-id`，前端能识别。

```typescript
// extensions/ChapterBlock.ts
import { Node } from '@tiptap/core';

export const ChapterBlock = Node.create({
  name: 'chapter',
  group: 'block',
  content: 'block+',
  
  attrs: {
    segmentId: { default: null },
    index: { default: 0 },
    title: { default: '' },
    version: { default: 1 },
  },
  
  parseHTML() {
    return [{ tag: 'section[data-segment-id]' }];
  },
  
  renderHTML({ node, HTMLAttributes }) {
    return [
      'section',
      {
        ...HTMLAttributes,
        'data-segment-id': node.attrs.segmentId,
        'data-version': node.attrs.version,
        class: 'chapter-block',
      },
      ['h2', { class: 'chapter-title' }, `第${node.attrs.index}章 ${node.attrs.title}`],
      ['div', { class: 'chapter-content' }, 0],   // 0 = content placeholder
    ];
  },
});
```

### 6.2.3 加载与渲染

```typescript
// 拉到任务后，把 segments 转成 TipTap doc
function buildEditorContent(task: Task): JSONContent {
  return {
    type: 'doc',
    content: task.segments.map(seg => ({
      type: 'chapter',
      attrs: {
        segmentId: seg.id,
        index: seg.index,
        title: seg.title,
        version: seg.version,
      },
      content: parseMarkdownToTiptapNodes(seg.content),
    })),
  };
}
```

## 6.3 三种修改模式

### 6.3.1 模式 A：直接手动编辑

用户点击章节内容直接键入修改，TipTap 原地编辑。

**保存时机：**
- 触发：用户点"保存"按钮 / Ctrl+S / 离开页面
- 不做"自动保存每次输入"，避免频繁请求 + 与 AI 流式输出冲突

**保存流程：**

```typescript
async function saveSegmentEdit(segId: number) {
  const node = editor.findChapterBlock(segId);
  const markdown = nodeToMarkdown(node.content);
  const currentVersion = node.attrs.version;
  
  try {
    const result = await api.patch(`/tasks/${taskId}/segments/${segId}`, {
      content: markdown,
      version: currentVersion,
    });
    
    // 服务端返回新版本号
    editor.updateAttributes(node, { version: result.version });
    toast.success('已保存');
  } catch (err) {
    if (err.status === 409) {
      // 版本冲突
      toast.error('内容已被他人/其他端修改，请刷新');
      // 提供"查看冲突"按钮触发对比视图
    }
  }
}
```

**乐观锁实现：**

```python
# app/api/routes/segments.py

@router.patch("/api/tasks/{task_id}/segments/{seg_id}")
async def update_segment(
    task_id: int, 
    seg_id: int,
    payload: SegmentUpdatePayload,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    seg = await db.get_segment(seg_id, task_id=task_id)
    if not seg:
        raise HTTPException(404)
    if seg.task.user_id != user.id and user.role != 'admin':
        raise HTTPException(403)
    if seg.task.status not in ('review', 'approved'):
        raise HTTPException(400, "当前状态不可编辑")
    
    # 乐观锁
    if seg.version != payload.version:
        raise HTTPException(409, detail={"current_version": seg.version})
    
    # 写历史版本（保留最近 20 个）
    await db.insert_segment_version(
        segment_id=seg_id,
        version=seg.version,
        content=seg.content,
        edit_type='manual',
        edited_by=user.id,
    )
    
    # 更新当前
    seg.content = payload.content
    seg.word_count = len(payload.content)
    seg.version += 1
    seg.updated_at = datetime.utcnow()
    
    # 更新整篇 tasks.content（重新拼接）
    await _reassemble_task_content(seg.task_id, db)
    
    await db.commit()
    
    # 写事件
    await db.insert_event(
        task_id=task_id,
        event_type='segment_edited',
        actor=f'user:{user.id}',
        payload={'segment_id': seg_id, 'version_after': seg.version, 'edit_type': 'manual'},
    )
    
    return {"version": seg.version, "word_count": seg.word_count}
```

### 6.3.2 模式 B：选中段落让 AI 改

**交互流程：**

1. 用户在编辑器选中文字
2. 右栏自动展示"已选中"卡片 + 选中字数
3. 用户在右栏输入指令（或点快捷指令）
4. 点"发送" → AI 流式返回建议
5. 前端展示 diff（红删绿增）
6. 用户点"接受" → 触发模式 A 的 PATCH

**API：**

```http
POST /api/tasks/{task_id}/ai-edit
Content-Type: application/json
Authorization: Bearer ...

{
  "segment_id": 12,
  "selection_start": 1234,
  "selection_end": 1456,
  "selected_text": "他走进了房间。",
  "instruction": "改得更生动些，加点动作描写",
  "context_range": "paragraph",     // sentence | paragraph | chapter | full
  "model": "claude-3-5-sonnet"      // 可选，默认任务配置
}
```

**响应（SSE 流）：**

```
event: token
data: {"content":"他"}

event: token
data: {"content":"蹑"}

...

event: done
data: {
  "suggestion": "他蹑手蹑脚地推开了房门，吱呀一声响在寂静中格外刺耳。",
  "tokens_used": 234
}
```

**后端实现要点：**

```python
@router.post("/api/tasks/{task_id}/ai-edit")
async def ai_edit(
    task_id: int,
    payload: AIEditPayload,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    llm: LLMClient = Depends(get_llm_client),
):
    # ... 鉴权 + 加载 task/segment ...
    
    # 构建上下文（根据 context_range）
    context = _build_edit_context(seg, payload)
    
    prompt = AI_EDIT_PROMPT.format(
        context_before=context['before'],
        selected=payload.selected_text,
        context_after=context['after'],
        instruction=payload.instruction,
    )
    
    async def event_stream():
        full_text = ""
        async for chunk in llm.stream(
            api_key=user.api_key,
            messages=[{"role": "user", "content": prompt}],
            model=payload.model or task.config['writing_model'],
            max_tokens=2000,
            temperature=0.7,
        ):
            if chunk.content:
                full_text += chunk.content
                yield {"event": "token", "data": json.dumps({"content": chunk.content})}
        
        yield {"event": "done", "data": json.dumps({
            "suggestion": full_text,
            "tokens_used": getattr(chunk, 'usage', {}).get('total_tokens', 0)
        })}
        
        # 记录到 messages 表（不写入 segment，等用户接受才写）
        await db.insert_message(
            task_id=task_id,
            segment_id=payload.segment_id,
            role='user',
            content=payload.instruction,
        )
        await db.insert_message(
            task_id=task_id,
            segment_id=payload.segment_id,
            role='assistant',
            content=full_text,
            metadata={'kind': 'ai_edit_suggestion'},
        )
    
    return EventSourceResponse(event_stream())
```

**Prompt 模板：**

```python
AI_EDIT_PROMPT = """你是一位资深小说编辑，正在帮用户修改一段文字。

【上文】
{context_before}

【需要修改的部分】
{selected}

【下文】
{context_after}

【用户指令】
{instruction}

请直接输出修改后的文字（替换"需要修改的部分"），不要解释，不要前言，不要重复上下文。"""
```

**前端 diff 展示：**

```typescript
import { diffWords } from 'diff';

function DiffPreview({ original, suggestion }: Props) {
  const parts = diffWords(original, suggestion);
  return (
    <div className="diff-view">
      {parts.map((p, i) => (
        <span 
          key={i}
          className={p.added ? 'bg-green-100 text-green-800' : p.removed ? 'bg-red-100 line-through text-red-800' : ''}
        >
          {p.value}
        </span>
      ))}
    </div>
  );
}
```

### 6.3.3 模式 C：审核期跟 AI 整体对话

**API：**

```http
POST /api/tasks/{task_id}/chat
{
  "message": "第三章节奏太快，能放慢些吗？",
  "include_full_text": false      // 是否把全文塞给 AI（默认只塞章节摘要）
}
```

**响应（SSE）：**

```
event: token
data: {"content":"第三章"}

...

event: action_proposal
data: {
  "type": "rewrite_segment",
  "segment_id": 13,
  "preview_content": "...新的第三章...",
  "diff_summary": "扩充了主角心理描写，节奏放缓约 20%"
}

event: done
data: {"message_id": 567}
```

**关键设计：** AI 的回复中如果包含修改提议，作为单独的 `action_proposal` event 推送，前端把它渲染成可操作的卡片：

```
┌─────────────────────────────────────────────────┐
│ AI 回复                                         │
│                                                 │
│ "我觉得第三章可以这样调整：在主角下定决心前    │
│ 加一段内心挣扎的描写..."                        │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ 💡 修改提议: 重写第3章                       │ │
│ │ 扩充心理描写，节奏放缓 20%                  │ │
│ │ [查看 diff]  [应用此修改]  [忽略]           │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**用户点"应用"** 才真正调 PATCH 写入。AI 永远只是"提议者"。

**对话历史：**
- 存到 `messages` 表，按 `task_id` 关联
- 编辑器右栏的 chat 面板加载该任务的历史对话
- 默认显示最近 N 条，可向上滚加载更多

## 6.4 一致性检查

### 6.4.1 触发方式

中栏底部按钮：`[一致性检查]`

点击后弹出 modal，AI 异步扫描全文，输出可疑点列表。

### 6.4.2 实现

```python
@router.post("/api/tasks/{task_id}/consistency-check")
async def consistency_check(task_id, user, db, llm):
    task = ...
    
    prompt = CONSISTENCY_CHECK_PROMPT.format(
        outline_summary=summarize_outline(task.outline),
        full_content=task.content,
    )
    
    async def stream():
        full = ""
        async for chunk in llm.stream(
            api_key=user.api_key,
            messages=[{"role": "user", "content": prompt}],
            model='claude-3-5-sonnet-20241022',
            max_tokens=4000,
        ):
            full += chunk.content
            yield {"event": "token", "data": ...}
        
        # 解析返回的 JSON
        try:
            issues = json.loads(full)
        except:
            issues = parse_with_fallback(full)
        
        yield {"event": "done", "data": json.dumps({"issues": issues})}
    
    return EventSourceResponse(stream())
```

**Prompt：**

```python
CONSISTENCY_CHECK_PROMPT = """你是一位严苛的小说审稿编辑。请扫描以下全文，找出跨章节的不一致问题。

需要重点检查：
1. 人物姓名、性别、年龄、外貌描写在不同章节是否一致
2. 时间线、地点是否前后矛盾
3. 物品、能力设定是否前后一致
4. 大纲中提到的关键情节是否都已涵盖

【大纲概要】
{outline_summary}

【全文】
{full_content}

请以 JSON 数组格式输出可疑点（如无问题则返回空数组）：
[
  {
    "severity": "high|medium|low",
    "category": "character|timeline|setting|plot",
    "location": "第X章",
    "description": "问题描述",
    "suggestion": "修正建议"
  }
]
"""
```

**前端展示：**

```
┌─────────────────────────────────────────────────┐
│ 一致性检查结果（共 3 项）              [关闭]    │
├─────────────────────────────────────────────────┤
│                                                 │
│ ⚠ HIGH  人物                                    │
│ 第 1 章描述主角"二十出头"，第 5 章变成"三十有余" │
│ 建议：统一为同一年龄设定                        │
│ [跳转到第1章] [跳转到第5章] [让AI自动修复]      │
│                                                 │
│ ⚠ MEDIUM  设定                                  │
│ 第 2 章说"剑名青锋"，第 7 章变成"剑名霜锋"     │
│ ...                                             │
│                                                 │
│ ⚠ LOW  情节                                     │
│ 大纲提到的"主角学会御剑"未在正文中体现        │
│ ...                                             │
└─────────────────────────────────────────────────┘
```

"让 AI 自动修复"会触发一次模式 B 的 ai-edit，自动把建议的修正应用到对应位置（仍需用户最终确认 diff）。

## 6.5 版本历史

### 6.5.1 数据保留

每次段落被修改（无论手动还是 AI），插入一条 `segment_versions` 记录。每段保留最近 **20 个版本**，超过自动删除最早的。

```sql
INSERT INTO segment_versions (segment_id, version, content, edit_type, edited_by, created_at)
VALUES (12, 5, '原内容...', 'ai_partial', 5, NOW());

-- 清理旧版本
DELETE FROM segment_versions 
WHERE segment_id = 12 
  AND id NOT IN (
    SELECT id FROM segment_versions 
    WHERE segment_id = 12 
    ORDER BY version DESC 
    LIMIT 20
  );
```

### 6.5.2 UI

中栏底部按钮：`[历史版本]`

打开侧栏：

```
┌─────────────────────────────────────────────┐
│ 历史版本                          [关闭]    │
├─────────────────────────────────────────────┤
│ 当前选中段：第3章                            │
│                                             │
│ ● v5 (当前)         · 2分钟前 · 手动编辑     │
│ ○ v4                · 10分钟前 · AI辅助修改  │
│ ○ v3                · 1小时前 · AI辅助修改  │
│ ○ v2                · 2小时前 · AI生成原始   │
│ ○ v1                · 3小时前 · AI生成原始   │
│                                             │
│ [查看选中版本]  [回滚到此版本]              │
└─────────────────────────────────────────────┘
```

回滚操作本质是一次"以历史版本为内容"的 PATCH，会创建新版本（不是物理回滚）。

## 6.6 Word 导出

```python
# app/services/exporter.py
from docx import Document
from docx.shared import Pt

def export_to_docx(task: Task) -> bytes:
    doc = Document()
    
    # 标题
    title = doc.add_heading(task.title, level=0)
    
    # 元信息
    meta = doc.add_paragraph()
    meta.add_run(f'字数：{task.word_count}　').italic = True
    meta.add_run(f'生成时间：{task.completed_at.strftime("%Y-%m-%d")}').italic = True
    
    # 章节
    for seg in task.segments_ordered():
        doc.add_heading(f'第{seg.index}章 {seg.title}', level=1)
        for paragraph in seg.content.split('\n\n'):
            if paragraph.strip():
                p = doc.add_paragraph(paragraph)
                p.style.font.size = Pt(11)
    
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


@router.get("/api/tasks/{task_id}/export.docx")
async def export(task_id: int, user, db):
    task = await db.get_task_with_segments(task_id)
    # ... 鉴权 ...
    if task.status != 'approved':
        raise HTTPException(400, "仅已审核通过的任务可导出")
    
    content = export_to_docx(task)
    return Response(
        content=content,
        media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        headers={
            'Content-Disposition': f'attachment; filename="{task.title}.docx"'
        }
    )
```

如需企业模板（封面、页眉页脚、特殊字体），可基于 `python-docx` 模板文件 (`.docx` 作为模板) + 占位符替换。MVP 用最简单格式即可。

## 6.7 编辑权限

| 任务状态 | 谁可编辑 | 编辑哪些 |
|---|---|---|
| `outline_review` | 任务所有者 + admin | 仅 outline JSON |
| `review` | 任务所有者 + admin | segments、AI 对话 |
| `approved` | 任务所有者 + admin（warning）| segments，但已"锁定"，编辑后状态保持 approved |
| 其他 | 都不可编辑（worker 在写） | - |

## 6.8 性能考量

| 项 | 性能 |
|---|---|
| 大文章渲染 | 1-2 万字 TipTap 单实例可承受，无需虚拟滚动 |
| AI edit 单次响应 | 通常 5-15 秒（流式即时反馈）|
| 一致性检查 | 通常 30-60 秒（全文塞给 LLM）|
| 历史版本查询 | 单段 20 个版本，瞬时返回 |
| Word 导出 | 1-2 万字 < 500ms |
