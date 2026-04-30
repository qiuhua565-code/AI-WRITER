from pathlib import Path
from jinja2 import Environment, FileSystemLoader

_env = Environment(
    loader=FileSystemLoader(Path(__file__).parent),
    trim_blocks=True,
    lstrip_blocks=True,
)

def render_prompt(template_path: str, **kwargs) -> str:
    """
    template_path: 相对于 app/prompts/ 的路径，如 'emotion_story/plan.j2'
    """
    tmpl = _env.get_template(template_path)
    return tmpl.render(**kwargs)
