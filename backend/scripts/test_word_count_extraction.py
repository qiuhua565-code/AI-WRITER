#!/usr/bin/env python3
"""
测试字数要求提取功能的脚本

用法：
    python scripts/test_word_count_extraction.py
"""
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.utils.word_count import (
    extract_word_count_requirement,
    count_words,
    generate_continue_prompt,
)


def test_extraction():
    """测试各种格式的字数要求提取"""
    test_cases = [
        ("请写5000字", 5000),
        ("至少3000字", 3000),
        ("不少于2000字", 2000),
        ("字数要求：4000", 4000),
        ("需要3k字", 3000),
        ("需要3K字", 3000),
        ("至少3000字，最好5000字", 5000),
        ("请帮我写一篇关于AI的文章，字数要求5000字以上", 5000),
        ("字数：3000字", 3000),
        ("请帮我写一篇文章", None),
        ("写一篇大约1000字的文章", 1000),
    ]

    print("=" * 60)
    print("字数要求提取测试")
    print("=" * 60)

    for text, expected in test_cases:
        result = extract_word_count_requirement(text)
        status = "✅" if result == expected else "❌"
        print(f"{status} 输入: {text}")
        print(f"   期望: {expected}, 实际: {result}")
        print()


def test_word_counting():
    """测试字数统计功能"""
    test_cases = [
        ("这是一段中文", 6),
        ("Hello world test", 3),
        ("这是中文 and English words", 7),
        ("<document><content>这是内容</content></document>", 4),
        ("测试" * 100, 200),
    ]

    print("=" * 60)
    print("字数统计测试")
    print("=" * 60)

    for text, expected in test_cases:
        result = count_words(text)
        status = "✅" if result == expected else "❌"
        display_text = text if len(text) < 50 else text[:50] + "..."
        print(f"{status} 输入: {display_text}")
        print(f"   期望: {expected}, 实际: {result}")
        print()


def test_continue_prompts():
    """测试续写提示生成"""
    test_cases = [
        ("测试" * 100, 5000, "end_turn"),  # 200字，缺4800字
        ("测试" * 2000, 5000, "end_turn"),  # 4000字，缺1000字
        ("测试" * 2400, 5000, "end_turn"),  # 4800字，缺200字
        ("测试" * 2500, 5000, "end_turn"),  # 5000字，已满足
        ("测试" * 100, None, "max_tokens"),  # 无要求，触顶
    ]

    print("=" * 60)
    print("续写提示生成测试")
    print("=" * 60)

    for accumulated, required, finish_reason in test_cases:
        current_words = count_words(accumulated)
        prompt = generate_continue_prompt(accumulated, required, finish_reason)

        print(f"场景: 当前 {current_words} 字, 要求 {required} 字, 结束原因 {finish_reason}")
        print(f"提示: {prompt[:100]}...")
        print()


def interactive_test():
    """交互式测试"""
    print("=" * 60)
    print("交互式测试（输入 'quit' 退出）")
    print("=" * 60)

    while True:
        text = input("\n请输入包含字数要求的文本: ").strip()
        if text.lower() in ("quit", "exit", "q"):
            break

        if not text:
            continue

        result = extract_word_count_requirement(text)
        if result:
            print(f"✅ 检测到字数要求: {result} 字")
        else:
            print("❌ 未检测到字数要求")


if __name__ == "__main__":
    test_extraction()
    test_word_counting()
    test_continue_prompts()

    print("\n" + "=" * 60)
    print("所有自动测试完成！")
    print("=" * 60)

    # 询问是否进行交互式测试
    choice = input("\n是否进行交互式测试？(y/n): ").strip().lower()
    if choice == "y":
        interactive_test()
