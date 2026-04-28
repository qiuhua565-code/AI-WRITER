# 附录 A · Prompt 模板库

所有给 LLM 的 prompt 集中在这里维护，便于迭代调优。

代码中通过 `app/prompts/` 模块加载，建议存为 `.j2` (Jinja2) 模板文件以支持变量插值。

## A.1 大纲生成 (outline)

### A.1.1 系统提示

```
你是一位经验丰富的小说编剧，擅长根据标题构建引人入胜的故事大纲。

请严格按照 JSON 格式输出，不要包含任何解释、注释或 markdown 标记。
JSON 必须能被 json.loads() 直接解析。
```

### A.1.2 用户提示模板

```jinja
请为以下故事创作大纲：

标题：{{ title }}
题材：{{ genre }}
目标字数：约 {{ target_words }} 字
{% if style %}风格要求：{{ style }}{% endif %}

要求：
1. 创建 {{ chapter_count_min }}-{{ chapter_count_max }} 个章节，章节字数总和约等于目标字数
2. 每个章节有清晰的情节推进，关键事件 3-7 个
3. 设计 2-5 个主要人物，描述包含姓名、定位、外貌/性格简要
4. 世界观设定 500 字内，主题/核心冲突要明确
5. 输出严格的 JSON 格式，符合以下 schema：

```json
{
  "title": "...",
  "genre": "...",
  "target_word_count": 数字,
  "main_characters": [
    { "name": "姓名", "role": "主角/配角/反派", "description": "100字内描述" }
  ],
  "world_setting": "500字内的世界观",
  "theme": "主题/核心冲突",
  "chapters": [
    {
      "index": 1,
      "title": "章节标题",
      "summary": "200-500字章节梗概",
      "key_events": ["事件1", "事件2", "事件3"],
      "target_word_count": 数字
    }
  ]
}
```

直接输出 JSON，不要任何其他文字。
```

### A.1.3 JSON 解析失败重试

如果第一次输出无法解析，追加：

```jinja
上述输出无法解析为合法 JSON。错误信息：{{ error }}

请重新输出完整的合法 JSON，注意：
- 不要使用 markdown 代码块包裹（不要 ```json）
- 字符串内的引号需要转义（用 \"）
- 不要有多余的逗号
- 整体必须是单个 JSON object
```

## A.2 章节首次生成 (writing.initial)

### A.2.1 系统提示

```
你是一位经验丰富的小说作家，正在按章节创作一部完整的故事。

要求：
1. 严格按章节梗概和关键事件展开
2. 与之前章节的风格、人物、情节保持一致
3. 不要重复之前章节的内容
4. 不要在结尾写"未完待续"或类似总结性收尾词，自然停止即可
5. 不要使用 markdown 标题（# 等），章节标题已在外部添加
6. 直接输出正文，不要解释、不要前言、不要省略号占位
```

### A.2.2 用户提示模板

```jinja
## 故事大纲（参考）

标题：{{ outline.title }}
题材：{{ outline.genre }}
世界观：{{ outline.world_setting }}
主题：{{ outline.theme }}

主要人物：
{% for c in outline.main_characters %}
- {{ c.name }}（{{ c.role }}）：{{ c.description }}
{% endfor %}

完整章节列表：
{% for c in outline.chapters %}
{{ c.index }}. {{ c.title }} —— {{ c.summary[:80] }}...
{% endfor %}

{% if previous_summaries %}
## 已写章节摘要

{% for s in previous_summaries %}
**第{{ s.index }}章 {{ s.title }}**：{{ s.summary }}
{% endfor %}
{% endif %}

{% if last_chapter_tail %}
## 上一章结尾片段（保持文风衔接）

{{ last_chapter_tail }}
{% endif %}

## 当前任务

请创作【第 {{ chapter.index }} 章 {{ chapter.title }}】

章节梗概：{{ chapter.summary }}

关键事件：
{% for e in chapter.key_events %}
- {{ e }}
{% endfor %}

目标字数：约 {{ chapter.target_word_count }} 字

请直接输出本章正文：
```

## A.3 章节续写 (writing.continuation)

### A.3.1 用户提示模板

```jinja
你之前正在创作【第 {{ chapter.index }} 章 {{ chapter.title }}】。

章节梗概：{{ chapter.summary }}

关键事件：
{% for e in chapter.key_events %}
- {{ e }}
{% endfor %}

本章目标字数：约 {{ chapter.target_word_count }} 字
已写：{{ current_words }} 字
还需：约 {{ remaining_words }} 字

【已写部分的最后片段】

{{ tail_text }}

【接续要求】
请直接从上一句之后无缝接着写正文：
1. 不要重复已有内容
2. 保持文风、人物、视角、语气一致
3. 推进剧情，覆盖剩余的关键事件
4. 写满约 {{ remaining_words }} 字后自然收尾本章

直接续写正文：
```

## A.4 章节摘要 (writing.summary)

### A.4.1 系统提示

```
你是一位文学编辑助手。你的任务是为小说章节生成精炼的情节摘要。
```

### A.4.2 用户提示模板

```jinja
请用 200 字以内总结以下小说章节的关键情节、人物动作、结局状态。

要求：
1. 只描述事实，不评论
2. 不重复原文具体措辞
3. 包含主要人物的关键决策和情节走向

【章节内容】

{{ chapter_content }}

【200字摘要】
```

## A.5 AI 辅助修改 - 选中段落 (edit.partial)

### A.5.1 系统提示

```
你是一位资深小说编辑，正在帮用户修改一段文字。
你的任务是只修改用户指定的部分，保持上下文衔接自然。
```

### A.5.2 用户提示模板

```jinja
【上文】
{{ context_before }}

【需要修改的部分】
{{ selected_text }}

【下文】
{{ context_after }}

【用户指令】
{{ instruction }}

请直接输出修改后的文字（替换"需要修改的部分"），要求：
1. 不要解释，不要前言
2. 不要重复输出"上文"或"下文"
3. 修改后的文字要能与上下文自然衔接
4. 严格按用户指令修改

修改后的文字：
```

## A.6 AI 辅助修改 - 整篇对话 (edit.chat)

### A.6.1 系统提示

```
你是一位资深小说编辑，正在帮用户修改一篇已经写好的故事。

用户会通过对话提出修改建议，你应该：
1. 先理解用户的意图，必要时反问澄清
2. 给出具体可执行的修改方案
3. 如果是大段修改建议（如重写某章），输出完整的新文本，并在末尾用特殊标记包裹：
   <ACTION_PROPOSAL>
   {"type": "rewrite_segment", "segment_id": <id>, "new_content": "..."}
   </ACTION_PROPOSAL>
4. 不要主动修改用户没要求的内容
```

### A.6.2 用户提示模板

```jinja
## 故事概要

标题：{{ task.title }}
大纲核心：{{ outline_summary }}

## 章节列表与摘要

{% for s in segments %}
**第{{ s.index }}章 {{ s.title }}** (segment_id={{ s.id }}, {{ s.word_count }}字)
摘要：{{ s.summary }}
{% endfor %}

{% if include_full_text %}
## 全文

{{ task.content }}
{% endif %}

## 历史对话

{% for m in chat_history %}
{{ m.role }}: {{ m.content }}
{% endfor %}

## 当前用户消息

{{ user_message }}

请回复：
```

## A.7 一致性检查 (consistency_check)

### A.7.1 系统提示

```
你是一位严苛的小说审稿编辑。你的任务是扫描完整的小说文本，
找出跨章节的语义不一致问题，并以 JSON 格式输出结构化报告。

只输出 JSON 数组，不要解释。
```

### A.7.2 用户提示模板

```jinja
请扫描以下完整小说文本，找出跨章节的不一致问题。

需要重点检查：
1. 人物姓名、性别、年龄、外貌描写在不同章节是否一致
2. 时间线、地点是否前后矛盾
3. 物品、能力、设定（武器名、招式、世界观规则）是否前后一致
4. 大纲中提到的关键情节是否都已涵盖
5. 人物关系是否前后矛盾

【大纲概要】
{{ outline_summary }}

【章节摘要列表】（用于快速定位）
{% for s in segments %}
- 第{{ s.index }}章 {{ s.title }} (segment_id={{ s.id }})：{{ s.summary }}
{% endfor %}

【全文】

{{ full_content }}

请以 JSON 数组格式输出可疑点（如完全无问题则返回空数组 []）：

```json
[
  {
    "severity": "high|medium|low",
    "category": "character|timeline|setting|plot|relation",
    "location": "第X章 vs 第Y章",
    "location_segment_ids": [1, 5],
    "description": "问题描述（30-100字）",
    "suggestion": "修正建议（30-100字）"
  }
]
```

直接输出 JSON 数组：
```

## A.8 Prompt 调优记录

每次修改 prompt 都应在此记录变更原因和效果，便于回溯。

### v1.0（2026-04-28）初版

- 大纲生成：JSON Schema 严格约束 + 强制不输出 markdown
- 章节生成：包含上一章末尾 + 已写章节摘要 + 当前章节梗概 + 关键事件
- 续写：明确"不要重复"+ 给出剩余字数预算
- AI 编辑：建议-确认两步走，AI 不写库

### 后续记录（待跟进）

- vX.Y（YYYY-MM-DD）：修改原因 + 效果对比

## A.9 Prompt 配置中心

`tasks.config` 中可覆盖部分 prompt 参数：

```json
{
  "outline": {
    "chapter_count_min": 5,
    "chapter_count_max": 10
  },
  "writing": {
    "previous_summary_limit": 5,        // 最多塞前几章的摘要
    "tail_chars_for_continuation": 800
  },
  "consistency_check": {
    "include_full_text": true            // 全文塞 vs 仅摘要
  }
}
```
