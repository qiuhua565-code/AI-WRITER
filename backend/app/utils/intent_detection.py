"""使用 LLM 识别用户意图"""
import json
import logging
from typing import Optional
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger(__name__)

# 过长用户正文易诱导模型「写文章」而非 JSON；意图识别只取前段
_INTENT_USER_TEXT_MAX = 6000


def _truncate_for_intent(user_message: str) -> str:
    t = (user_message or "").strip()
    if len(t) <= _INTENT_USER_TEXT_MAX:
        return t
    return t[:_INTENT_USER_TEXT_MAX] + f"\n\n[…已截断，原文共 {len(t)} 字，仅用于意图分析]"


def _normalize_intent_raw_response(raw: str) -> str:
    s = (raw or "").strip()
    low = s[:12].lower()
    if low.startswith("markdown"):
        s = s[8:].lstrip()
    if s.startswith("```json"):
        s = s[7:]
    if s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[:-3]
    return s.strip()


def _extract_first_json_object(s: str) -> str | None:
    """从混杂输出中抠出第一个平衡花括号的 JSON 对象（支持 summary 等字段中带引号）。"""
    start = s.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    string_char = ""
    for i in range(start, len(s)):
        ch = s[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == string_char:
                in_string = False
            continue
        if ch in ('"', "'"):
            in_string = True
            string_char = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    return None


@dataclass
class UserIntent:
    """用户意图"""
    word_count_requirement: Optional[int] = None  # 字数要求
    is_full_output: bool = False  # 是否要求完整输出
    is_continue_request: bool = False  # 是否要求继续之前的内容
    is_check_request: bool = False  # 是否要求检查文章
    action: str = "generate"  # 动作：generate/expand/revise/continue/check
    summary: str = ""  # 意图摘要
    target_section: Optional[str] = None  # 目标修改部分：引子/正文/卡点/结尾等


async def detect_user_intent_with_llm(
    user_message: str,
    llm_client,
    api_key: str,
) -> UserIntent:
    """
    使用 LLM 识别用户意图

    返回：
    - word_count_requirement: 字数要求（如果有）
    - is_full_output: 是否要求输出完整版本
    - is_continue_request: 是否要求继续之前中断的内容
    - action: 用户想做什么（generate/expand/revise/continue）
    - summary: 意图摘要
    """

    system_prompt = """你是一个意图识别助手。分析用户的请求，提取以下信息：

1. word_count_requirement: 用户要求的字数（数字，如果没有明确要求则为 null）
2. is_full_output: 用户是否要求输出完整版本（true/false）
   - 关键词：完整、重新输出、扩充到、改成、从头到尾、全文、整理全文等
3. is_continue_request: 用户是否要求继续之前中断的内容（true/false）
   - 关键词：继续、接着、往下、补充完整等
4. is_check_request: 用户是否要求检查文章（true/false）
   - 关键词：检查、审查、查看、有没有问题、有没有错误等
5. action: 用户想做什么
   - "generate": 生成新内容
   - "expand": 扩充现有内容
   - "revise": 修改现有内容
   - "continue": 继续之前中断的内容
   - "check": 检查文章质量
6. target_section: 用户想修改的具体部分（如果有，否则为 null）
   - 可能的值：引子、正文、卡点、结尾、开头、第X段等
7. summary: 用一句话总结用户的意图

请以 JSON 格式返回，不要添加任何其他文字。

【硬性约束】你只输出一个 JSON 对象。禁止输出 Markdown、禁止写文章、禁止输出标题或正文、禁止输出 ``` 代码块、禁止复述用户长文；第一个非空白字符必须是「{」，且整段输出仅为从该字符起与之配对闭合的一个 JSON 对象。

示例：
用户："请写一篇关于AI的文章，5000字"
返回：{"word_count_requirement": 5000, "is_full_output": true, "is_continue_request": false, "is_check_request": false, "action": "generate", "target_section": null, "summary": "生成一篇5000字的AI文章"}

用户："字数不够，扩充到10000字"
返回：{"word_count_requirement": 10000, "is_full_output": true, "is_continue_request": false, "is_check_request": false, "action": "expand", "target_section": null, "summary": "将现有内容扩充到10000字"}

用户："继续写，刚才断了"
返回：{"word_count_requirement": null, "is_full_output": false, "is_continue_request": true, "is_check_request": false, "action": "continue", "target_section": null, "summary": "继续之前中断的内容"}

用户："引子写的不好，需要修改"
返回：{"word_count_requirement": null, "is_full_output": true, "is_continue_request": false, "is_check_request": false, "action": "revise", "target_section": "引子", "summary": "修改引子部分"}

用户："检查一下文章有没有问题"
返回：{"word_count_requirement": null, "is_full_output": false, "is_continue_request": false, "is_check_request": true, "action": "check", "target_section": null, "summary": "检查文章质量"}

用户："卡点部分写的不好需要调整，然后整理一下全文输出"
返回：{"word_count_requirement": null, "is_full_output": true, "is_continue_request": false, "is_check_request": false, "action": "revise", "target_section": "卡点", "summary": "修改卡点部分并输出完整版本"}
"""

    try:
        user_for_intent = _truncate_for_intent(user_message)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_for_intent},
        ]

        # 单次 complete：比 stream 聚合更不易被网关/模型截断成非 JSON
        completion = await llm_client.complete(
            api_key=api_key,
            messages=messages,
            model=settings.LLM_DEFAULT_MODEL,
            max_tokens=700,
            temperature=0,
        )
        response_text = _normalize_intent_raw_response(completion.content)

        if not response_text:
            logger.warning(
                "Intent LLM returned empty body (upstream may have filtered or failed); using default intent"
            )
            raise ValueError("empty intent response")

        try:
            result = json.loads(response_text)
        except json.JSONDecodeError as je:
            blob = _extract_first_json_object(response_text)
            if blob:
                try:
                    result = json.loads(blob)
                except json.JSONDecodeError as je2:
                    snippet = response_text[:200].replace("\n", " ")
                    logger.warning(
                        "Intent JSON extract failed (char %s); snippet=%r; using default intent",
                        getattr(je2, "pos", None),
                        snippet,
                    )
                    raise je2
            else:
                snippet = response_text[:200].replace("\n", " ")
                logger.warning(
                    "Intent LLM returned non-JSON (parse at char %s); snippet=%r; using default intent",
                    getattr(je, "pos", None),
                    snippet,
                )
                raise

        intent = UserIntent(
            word_count_requirement=result.get("word_count_requirement"),
            is_full_output=result.get("is_full_output", False),
            is_continue_request=result.get("is_continue_request", False),
            is_check_request=result.get("is_check_request", False),
            action=result.get("action", "generate"),
            summary=result.get("summary", ""),
            target_section=result.get("target_section")
        )

        logger.info(
            "Detected user intent: word_count=%s, full_output=%s, continue=%s, check=%s, action=%s, target=%s, summary=%s",
            intent.word_count_requirement,
            intent.is_full_output,
            intent.is_continue_request,
            intent.is_check_request,
            intent.action,
            intent.target_section,
            intent.summary
        )

        return intent

    except Exception as e:
        logger.warning("Intent detection fallback (LLM unavailable or bad output): %s", e)
        # 降级：返回默认意图
        return UserIntent(
            word_count_requirement=None,
            is_full_output=False,
            is_continue_request=False,
            is_check_request=False,
            action="generate",
            summary="生成内容",
            target_section=None
        )


def count_words(text: str) -> int:
    """统计总字数（中文字符 + 英文单词）"""
    import re

    # 移除 XML 标签
    text = re.sub(r'<[^>]+>', '', text)

    # 统计中文字符
    chinese_count = len(re.findall(r'[\u4e00-\u9fff]', text))

    # 统计英文单词（移除中文后再统计）
    text_without_chinese = re.sub(r'[\u4e00-\u9fff]', ' ', text)
    english_words = re.findall(r'\b[a-zA-Z]+\b', text_without_chinese)
    english_count = len(english_words)

    return chinese_count + english_count


def extract_last_sentence(text: str, max_length: int = 100) -> str:
    """提取文本的最后一句话"""
    import re

    # 移除 XML 标签
    text = re.sub(r'<[^>]+>', '', text)
    text = text.strip()

    if not text:
        return ""

    # 如果文本很短，直接返回
    if len(text) <= max_length:
        return text

    # 提取最后部分
    last_part = text[-max_length * 2:]

    # 尝试找到最后一个句号、问号或感叹号
    sentence_endings = re.finditer(r'[。！？.!?]', last_part)
    endings = list(sentence_endings)

    if endings:
        # 找到最后一个句子结束位置
        last_ending = endings[-1]
        last_sentence = last_part[last_ending.end():].strip()

        # 如果最后一句太短，包含倒数第二句
        if len(last_sentence) < 20 and len(endings) >= 2:
            second_last_ending = endings[-2]
            last_sentence = last_part[second_last_ending.end():].strip()

        return last_sentence if last_sentence else last_part[-max_length:]

    # 没有找到句子结束符，返回最后部分
    return last_part[-max_length:]


def generate_continue_prompt(
    accumulated_text: str,
    required_words: Optional[int],
    user_intent: UserIntent,
) -> str:
    """
    生成续写提示词
    """
    current_words = count_words(accumulated_text)

    # 提取最后一句话
    last_context = extract_last_sentence(accumulated_text, max_length=100)

    # 如果是"继续"请求（中断后恢复）
    if user_intent.is_continue_request:
        return f"""上文因故中断，当前已输出 {current_words} 字。

上文最后内容：「{last_context}」

请从上述内容自然延续，继续输出后续内容。不要重复已写内容，不要添加说明性文字，直接输出文章正文。
"""

    # 如果是检查请求，生成检查提示
    if user_intent.is_check_request:
        return generate_check_prompt(accumulated_text)

    # 如果没有字数要求
    if not required_words:
        return f"""上文最后内容：「{last_context}」

请从上述内容自然延续，继续写作。不要重复已写内容，不要添加说明性文字，直接输出文章正文。
"""

    # 有字数要求
    shortage = required_words - current_words

    if shortage <= 0:
        return "字数已满足要求，请自然收尾。"

    if shortage > 2000:
        return f"""当前已输出 {current_words} 字，距离要求的 {required_words} 字还差 {shortage} 字。

上文最后内容：「{last_context}」

请从上述内容自然延续，继续写作。充分展开内容，可以通过以下方式扩充：
- 增加具体案例、数据或引用
- 深入分析某个观点或论点
- 补充相关背景知识或历史
- 增加场景描写、对话或细节刻画

重要：不要重复已写内容，不要添加说明性文字，直接输出文章正文，保持叙事连贯自然。
"""
    elif shortage > 500:
        return f"""当前已输出 {current_words} 字，距离要求的 {required_words} 字还差 {shortage} 字。

上文最后内容：「{last_context}」

请从上述内容自然延续，继续补充内容。可以增加细节、对话、案例或场景描写，确保达到字数要求。不要重复已写内容，不要添加说明性文字，直接输出文章正文。
"""
    else:
        return f"""当前已输出 {current_words} 字，距离要求的 {required_words} 字还差 {shortage} 字。

上文最后内容：「{last_context}」

请简短补充内容以达到字数要求，然后自然收尾。保持与上文的连贯性，不要添加说明性文字，直接输出文章正文。
"""


def generate_check_prompt(article_content: str) -> str:
    """
    生成文章检查提示词

    检查项目：
    1. 称谓错误
    2. 逻辑不合理
    3. 时间安排不可能发生的事情
    4. 免费部分和卡点衔接
    5. 免费部分是否透露悬疑答案
    6. 是否有强烈暗示导致剧透
    7. 字数是否足够
    8. 是否有重复句子
    9. 是否出现剧透、重复、反复、相似、无效、暗示情节
    10. 是否有真实地名、具体时间、真实人名
    11. 是否按要求分段
    """
    current_words = count_words(article_content)

    return f"""请对以下文章进行全面检查，并给出详细的检查报告：

【文章内容】
{article_content}

【检查项目】
请逐项检查以下内容，并给出具体的问题位置和修改建议：

1. **称谓错误**：检查文章中人物称谓是否前后一致，是否有称谓混乱的情况
2. **逻辑合理性**：检查情节发展是否符合逻辑，是否有前后矛盾的地方
3. **时间安排**：检查时间线是否合理，是否有根本不可能发生的事情
4. **免费部分与卡点衔接**：检查免费部分和卡点是否衔接得上，过渡是否自然
5. **悬疑保护**：检查免费部分是否透露悬疑答案，是否有强烈暗示导致剧透
6. **字数统计**：当前字数为 {current_words} 字，是否满足要求
7. **重复检查**：检查是否有重复句子、重复情节、反复描写、相似内容
8. **剧透检查**：检查是否出现剧透、无效暗示、过度提示等问题
9. **真实信息**：检查是否有真实地名（如"北京市朝阳区XX街"）、具体时间（如"2025年3月15日"）、真实人名，如有请标注
10. **分段检查**：检查是否有大段未分段的情况，段落是否合理

【输出格式】
请按以下格式输出检查结果：

## 检查报告

### 1. 称谓检查
- [问题/正常]

### 2. 逻辑检查
- [问题/正常]

### 3. 时间安排检查
- [问题/正常]

### 4. 免费部分与卡点衔接
- [问题/正常]

### 5. 悬疑保护
- [问题/正常]

### 6. 字数统计
- 当前字数：{current_words} 字
- [是否满足要求]

### 7. 重复检查
- [问题/正常]

### 8. 剧透检查
- [问题/正常]

### 9. 真实信息检查
- [问题/正常]

### 10. 分段检查
- [问题/正常]

## 总结
[整体评价和主要修改建议]

请开始检查：
"""


def should_continue_for_word_count(
    accumulated_text: str,
    required_words: Optional[int],
    finish_reason: str | None,
    segment_index: int,
    max_segments: int,
) -> tuple[bool, Optional[str]]:
    """
    判断是否需要继续生成以满足字数要求
    """
    # 如果没有字数要求，使用原有逻辑
    if not required_words:
        if not finish_reason:
            return False, None
        r = str(finish_reason).strip().lower()
        if r in ("max_tokens", "length"):
            return True, f"hit token limit ({finish_reason})"
        return False, None

    # 有字数要求时的逻辑
    current_words = count_words(accumulated_text)

    # 已达到字数要求
    if current_words >= required_words:
        return False, f"word count satisfied ({current_words}/{required_words})"

    # 达到最大段数限制
    if segment_index >= max_segments - 1:
        return False, f"max segments reached ({current_words}/{required_words} words)"

    # 字数不足，需要续写
    shortage = required_words - current_words
    return True, f"word count insufficient ({current_words}/{required_words}, need {shortage} more)"
