"""任务对用户可见的固定提示文案（避免魔法字符串分散在多处）。"""

# Celery 在拿不到系统写稿 Key 锁时写入 Task.warning_msg；Orchestrator 进入 writing 时清除。
KEY_QUEUE_WAITING_MSG = (
    "系统写稿 API Key 已全部占用，本任务正在排队等待（其他任务释放后会自动开始）。"
    "可联系管理员增加「写稿/task」用途的系统 Key，或在用户设置中绑定「生成」用途的个人 Key。"
)


def is_key_queue_waiting_message(msg: str | None) -> bool:
    if not msg:
        return False
    return "API Key 已全部占用" in msg and "排队等待" in msg
