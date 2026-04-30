"""
Word export service.

Converts a task's assembled content into a properly formatted .docx file.

Format:
  - Title (Heading 1)
  - Declaration (italic paragraph)
  - Blank line
  - 引子, 免费部分, 卡点, 付费部分 as body text
  - Divider line between free/paywall sections
"""

import io
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

from app.models.task import Task
from app.models.segment import Segment


def build_docx(task: Task, segments: list[Segment]) -> bytes:
    doc = Document()

    # ── Styles ────────────────────────────────────────────────────────────
    style = doc.styles["Normal"]
    font = style.font
    font.name = "宋体"
    font.size = Pt(12)

    # ── Title (Heading 1) ─────────────────────────────────────────────────
    heading = doc.add_heading(f"回顾：{task.title}", level=1)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # ── Declaration ───────────────────────────────────────────────────────
    declaration_para = doc.add_paragraph(
        "本文根据真实社会事件改编，人物均已化名处理，如有雷同纯属巧合。"
    )
    declaration_para.runs[0].italic = True
    declaration_para.runs[0].font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    doc.add_paragraph()  # blank line

    # ── Segment map ───────────────────────────────────────────────────────
    seg_map = {s.segment_type: s for s in segments}

    def _add_section(stype: str):
        seg = seg_map.get(stype)
        if not seg or not seg.content:
            return
        for line in seg.content.splitlines():
            if line.strip():
                doc.add_paragraph(line.strip())
            else:
                doc.add_paragraph()

    # ── Intro + Free ──────────────────────────────────────────────────────
    _add_section("intro")
    doc.add_paragraph()
    _add_section("free")
    doc.add_paragraph()

    # ── Divider ───────────────────────────────────────────────────────────
    divider = doc.add_paragraph("━" * 24)
    divider.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph()

    # ── Paywall ───────────────────────────────────────────────────────────
    _add_section("paywall")
    doc.add_paragraph()

    # ── Paid unlock marker ────────────────────────────────────────────────
    unlock_para = doc.add_paragraph("【付费解锁】")
    unlock_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph()

    divider2 = doc.add_paragraph("━" * 24)
    divider2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph()

    # ── Paid section ─────────────────────────────────────────────────────
    _add_section("paid")

    # ── Serialize ─────────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read()
