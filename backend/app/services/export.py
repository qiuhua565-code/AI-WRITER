import io
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

from app.models.task import Task
from app.models.segment import Segment

CHAPTER_TITLES = {
    "chapter_1": "第一章",
    "chapter_2": "第二章",
    "chapter_3": "第三章",
    "chapter_4": "第四章",
    "chapter_5": "第五章",
    "chapter_6": "第六章",
    "chapter_7": "第七章",
    "epilogue":  "尾声",
}

CHAPTER_ORDER = list(CHAPTER_TITLES.keys())


def build_docx(task: Task, segments: list[Segment]) -> bytes:
    doc = Document()

    style = doc.styles["Normal"]
    style.font.name = "宋体"
    style.font.size = Pt(12)

    # Title
    heading = doc.add_heading(f"回顾：{task.title}", level=1)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Declaration
    decl = doc.add_paragraph("本文根据真实社会事件改编，人物均已化名处理，如有雷同纯属巧合。")
    decl.runs[0].italic = True
    decl.runs[0].font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    doc.add_paragraph()

    # Sort segments by their canonical order
    seg_map = {s.segment_type: s for s in segments}
    ordered = [seg_map[t] for t in CHAPTER_ORDER if t in seg_map and seg_map[t].content]

    for seg in ordered:
        title = CHAPTER_TITLES.get(seg.segment_type, seg.title or "")

        # Chapter divider + title
        divider = doc.add_paragraph(f"{'━' * 10}  {title}  {'━' * 10}")
        divider.alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_paragraph()

        # Body — preserve paragraph breaks
        for line in seg.content.splitlines():
            if line.strip():
                doc.add_paragraph(line.strip())
            else:
                doc.add_paragraph()

        doc.add_paragraph()

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read()
