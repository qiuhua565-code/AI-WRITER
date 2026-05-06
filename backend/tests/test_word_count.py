"""测试字数统计和要求提取功能"""
import pytest
from app.utils.word_count import (
    count_chinese_chars,
    count_words,
    extract_word_count_requirement,
    should_continue_for_word_count,
    generate_continue_prompt,
)


class TestCountChineseChars:
    def test_pure_chinese(self):
        assert count_chinese_chars("这是一段中文") == 6

    def test_chinese_with_punctuation(self):
        assert count_chinese_chars("你好，世界！") == 4

    def test_chinese_with_english(self):
        text = "这是中文 and English"
        assert count_chinese_chars(text) == 4

    def test_with_xml_tags(self):
        text = "<content>这是内容</content>"
        assert count_chinese_chars(text) == 4

    def test_empty_string(self):
        assert count_chinese_chars("") == 0


class TestCountWords:
    def test_pure_chinese(self):
        assert count_words("这是一段中文") == 6

    def test_pure_english(self):
        assert count_words("Hello world test") == 3

    def test_mixed_content(self):
        text = "这是中文 and English words"
        # 4 个中文字符 + 3 个英文单词
        assert count_words(text) == 7

    def test_with_xml_tags(self):
        text = "<document><content>这是内容</content></document>"
        assert count_words(text) == 4

    def test_with_numbers(self):
        # 数字不计入英文单词
        text = "这是123测试"
        assert count_words(text) == 4


class TestExtractWordCountRequirement:
    def test_simple_format(self):
        assert extract_word_count_requirement("请写5000字") == 5000

    def test_with_at_least(self):
        assert extract_word_count_requirement("至少3000字") == 3000

    def test_with_no_less_than(self):
        assert extract_word_count_requirement("不少于2000字") == 2000

    def test_with_requirement_prefix(self):
        assert extract_word_count_requirement("字数要求：4000") == 4000

    def test_with_k_suffix(self):
        assert extract_word_count_requirement("需要3k字") == 3000
        assert extract_word_count_requirement("需要3K字") == 3000

    def test_multiple_numbers_takes_max(self):
        text = "至少3000字，最好5000字"
        assert extract_word_count_requirement(text) == 5000

    def test_complex_sentence(self):
        text = "请帮我写一篇关于AI的文章，字数要求5000字以上，要有深度"
        assert extract_word_count_requirement(text) == 5000

    def test_no_requirement(self):
        assert extract_word_count_requirement("请帮我写一篇文章") is None

    def test_with_colon(self):
        assert extract_word_count_requirement("字数：3000字") == 3000


class TestShouldContinueForWordCount:
    def test_no_requirement_hit_token_limit(self):
        should_continue, reason = should_continue_for_word_count(
            accumulated_text="一些文本",
            required_words=None,
            finish_reason="max_tokens",
            segment_index=0,
            max_segments=8,
        )
        assert should_continue is True
        assert "hit token limit" in reason

    def test_no_requirement_normal_end(self):
        should_continue, reason = should_continue_for_word_count(
            accumulated_text="一些文本",
            required_words=None,
            finish_reason="end_turn",
            segment_index=0,
            max_segments=8,
        )
        assert should_continue is False

    def test_word_count_satisfied(self):
        # 生成 5000+ 字的文本
        text = "测试" * 2500
        should_continue, reason = should_continue_for_word_count(
            accumulated_text=text,
            required_words=5000,
            finish_reason="end_turn",
            segment_index=0,
            max_segments=8,
        )
        assert should_continue is False
        assert "word count satisfied" in reason

    def test_word_count_insufficient(self):
        text = "测试" * 100  # 200 字
        should_continue, reason = should_continue_for_word_count(
            accumulated_text=text,
            required_words=5000,
            finish_reason="end_turn",
            segment_index=0,
            max_segments=8,
        )
        assert should_continue is True
        assert "word count insufficient" in reason
        assert "4800 more" in reason

    def test_max_segments_reached(self):
        text = "测试" * 100  # 200 字
        should_continue, reason = should_continue_for_word_count(
            accumulated_text=text,
            required_words=5000,
            finish_reason="end_turn",
            segment_index=7,
            max_segments=8,
        )
        assert should_continue is False
        assert "max segments reached" in reason


class TestGenerateContinuePrompt:
    def test_no_requirement(self):
        prompt = generate_continue_prompt(
            accumulated_text="一些文本",
            required_words=None,
            finish_reason="max_tokens",
        )
        assert "上文可能因单次回复长度达到上限" in prompt

    def test_word_count_satisfied(self):
        text = "测试" * 2500  # 5000 字
        prompt = generate_continue_prompt(
            accumulated_text=text,
            required_words=5000,
            finish_reason="end_turn",
        )
        assert "字数已满足要求" in prompt

    def test_large_shortage(self):
        text = "测试" * 100  # 200 字
        prompt = generate_continue_prompt(
            accumulated_text=text,
            required_words=5000,
            finish_reason="end_turn",
        )
        assert "当前已输出 200 字" in prompt
        assert "距离要求的 5000 字还差 4800 字" in prompt
        assert "充分展开内容" in prompt

    def test_medium_shortage(self):
        text = "测试" * 2000  # 4000 字
        prompt = generate_continue_prompt(
            accumulated_text=text,
            required_words=5000,
            finish_reason="end_turn",
        )
        assert "当前已输出 4000 字" in prompt
        assert "距离要求的 5000 字还差 1000 字" in prompt
        assert "增加细节" in prompt

    def test_small_shortage(self):
        text = "测试" * 2400  # 4800 字
        prompt = generate_continue_prompt(
            accumulated_text=text,
            required_words=5000,
            finish_reason="end_turn",
        )
        assert "当前已输出 4800 字" in prompt
        assert "距离要求的 5000 字还差 200 字" in prompt
        assert "简短补充" in prompt
