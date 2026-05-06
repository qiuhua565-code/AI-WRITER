"""字数统计和要求提取工具"""
import re
from typing import Optional


def count_chinese_chars(text: str) -> int:
    """统计中文字符数（不含标点、空格、英文）"""
    # 移除 XML 标签
    text = re.sub(r'<[^>]+>', '', text)
    # 只统计中文字符
    chinese_chars = re.findall(r'[\u4e00-\u9fff]', text)
    return len(chinese_chars)


def count_words(text: str) -> int:
    """统计总字数（中文字符 + 英文单词）"""
    # 移除 XML 标签
    text = re.sub(r'<[^>]+>', '', text)

    # 统计中文字符
    chinese_count = len(re.findall(r'[\u4e00-\u9fff]', text))

    # 统计英文单词（移除中文后再统计）
    text_without_chinese = re.sub(r'[\u4e00-\u9fff]', ' ', text)
    english_words = re.findall(r'\b[a-zA-Z]+\b', text_without_chinese)
    english_count = len(english_words)

    return chinese_count + english_count


def extract_word_count_requirement(text: str) -> Optional[int]:
    """
    从用户消息中提取字数要求

    支持的格式：
    - "5000字"
    - "至少3000字"
    - "不少于2000字"
    - "字数要求：4000"
    - "要求字数5000字以上"
    - "3k字" / "3K字"
    - "扩充到5000字"
    - "改成3000字"
    """
    patterns = [
        r'(?:至少|不少于|最少|要求|需要|扩充到|改成|改为)?[\s：:]*(\d+)[kK]?[\s]*字',
        r'字数[\s：:]*(?:至少|不少于|最少|要求)?[\s：:]*(\d+)[kK]?',
        r'(\d+)[kK]?[\s]*字[\s]*(?:以上|左右|上下)?',
    ]

    for pattern in patterns:
        matches = re.findall(pattern, text)
        if matches:
            # 取最大值（用户可能说"至少3000字，最好5000字"）
            numbers = []
            for match in matches:
                num_str = match if isinstance(match, str) else match[0]
                num = int(num_str)
                # 处理 k/K 后缀
                if re.search(rf'{num_str}[kK]', text):
                    num *= 1000
                numbers.append(num)
            if numbers:
                return max(numbers)

    return None


def detect_full_output_intent(user_message: str) -> bool:
    """
    检测用户是否要求输出完整版本

    关键词：
    - "输出完整版"、"完整输出"、"重新输出"
    - "扩充到X字"、"改成X字"
    - "再输出一遍"、"重新生成"
    - "输出全文"、"完整版本"
    """
    full_output_keywords = [
        "完整版", "完整输出", "重新输出", "输出完整",
        "扩充到", "改成", "改为",
        "再输出", "重新生成", "重新写",
        "输出全文", "全文输出", "完整文章",
        "输出新版", "新版本", "完整的",
        "从头", "从头到尾", "全部输出"
    ]

    message_lower = user_message.lower()
    return any(keyword in message_lower for keyword in full_output_keywords)


def detect_lazy_response(response: str, user_request: str = "") -> bool:
    """
    检测 AI 是否只是重复用户的话或确认任务，而没有实际输出内容

    特征：
    - 响应很短（< 100 字）
    - 包含确认性词语（"好的"、"明白了"、"我会"等）
    - 没有实际的文章内容
    """
    response_words = count_words(response)

    # 响应太短
    if response_words < 100:
        # 检查是否包含确认性词语
        confirmation_keywords = [
            "好的", "明白了", "我会", "我将", "我来",
            "收到", "了解", "知道了", "没问题",
            "开始", "现在", "接下来", "马上",
            "立即", "立刻", "这就"
        ]

        # 统计确认性词语出现次数
        confirmation_count = sum(1 for keyword in confirmation_keywords if keyword in response)

        # 如果确认性词语占比过高，认为是偷懒
        if confirmation_count >= 2 or (confirmation_count >= 1 and response_words < 50):
            return True

    return False


def extract_last_sentence(text: str, max_length: int = 100) -> str:
    """
    提取文本的最后一句话

    用于续写提示，帮助 AI 理解当前写到哪里
    """
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


def generate_full_output_prompt(
    current_content: str,
    user_request: str,
    required_words: Optional[int],
) -> str:
    """
    生成"完整输出"提示

    明确告诉 AI：
    1. 需要输出完整的新版本
    2. 不是只输出修改的部分
    3. 从头到尾完整输出
    """
    current_words = count_words(current_content)

    prompt = f"""用户要求：{user_request}

当前版本字数：{current_words} 字

**重要指令**：
1. 请输出一个**完整的新版本**，从头到尾完整输出
2. 不要只输出修改的部分或增量内容
3. 不要重复用户的话或确认任务（如"好的"、"明白了"等）
4. 直接开始输出完整的文章内容，从第一个字开始
"""

    if required_words:
        prompt += f"""5. 目标字数：{required_words} 字
6. 如果字数不足，系统会自动要求你继续输出，请配合完成
"""

    prompt += """
7. 输出格式：直接输出文章正文，不要添加任何前缀或说明

现在请立即开始输出完整的新版本：
"""

    return prompt


def should_continue_for_word_count(
    accumulated_text: str,
    required_words: Optional[int],
    finish_reason: str | None,
    segment_index: int,
    max_segments: int,
) -> tuple[bool, Optional[str]]:
    """
    判断是否需要继续生成以满足字数要求

    Returns:
        (should_continue, reason_message)
        - should_continue: 是否需要续写
        - reason_message: 续写原因（用于日志）
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


def generate_continue_prompt(
    accumulated_text: str,
    required_words: Optional[int],
    finish_reason: str | None,
) -> str:
    """
    生成续写提示词

    根据是否有字数要求，生成不同的续写提示
    """
    # 如果没有字数要求，使用默认提示
    if not required_words:
        return (
            "上文可能因单次回复长度达到上限而暂停。请从上一段末尾无缝续写，不要重复已写过的段落，"
            "保持人设、语气与叙事连贯；若故事已自然结束请直接收束，勿赘述。"
        )

    # 有字数要求时的提示
    current_words = count_words(accumulated_text)
    shortage = required_words - current_words

    if shortage <= 0:
        return "字数已满足要求，请自然收尾。"

    # 提取最后一句话作为上下文提示
    last_context = extract_last_sentence(accumulated_text, max_length=100)

    # 根据缺少的字数生成不同的提示
    if shortage > 2000:
        return (
            f"当前已输出 {current_words} 字，距离要求的 {required_words} 字还差 {shortage} 字。\n\n"
            f"上文最后内容：「{last_context}」\n\n"
            f"请从上述内容自然延续，继续写作。充分展开内容，可以通过以下方式扩充：\n"
            f"- 增加具体案例、数据或引用\n"
            f"- 深入分析某个观点或论点\n"
            f"- 补充相关背景知识或历史\n"
            f"- 增加场景描写、对话或细节刻画\n\n"
            f"重要：不要重复已写内容，不要添加说明性文字，直接输出文章正文，保持叙事连贯自然。"
        )
    elif shortage > 500:
        return (
            f"当前已输出 {current_words} 字，距离要求的 {required_words} 字还差 {shortage} 字。\n\n"
            f"上文最后内容：「{last_context}」\n\n"
            f"请从上述内容自然延续，继续补充内容。可以增加细节、对话、案例或场景描写，"
            f"确保达到字数要求。不要重复已写内容，不要添加说明性文字，直接输出文章正文。"
        )
    else:
        return (
            f"当前已输出 {current_words} 字，距离要求的 {required_words} 字还差 {shortage} 字。\n\n"
            f"上文最后内容：「{last_context}」\n\n"
            f"请简短补充内容以达到字数要求，然后自然收尾。保持与上文的连贯性，不要添加说明性文字，直接输出文章正文。"
        )

