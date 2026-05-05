"""
创建管理员用户的脚本。

用法：
  python scripts/create_admin.py --email admin@example.com --password yourpassword

如果用户已存在则更新密码和角色。
"""

import argparse
import asyncio
import sys
import os

# Allow running from repo root or scripts/ dir
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.user import User
from app.utils.security import hash_password


async def create_admin(email: str, password: str, name: str):
    async with AsyncSessionLocal() as db:
        existing = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()

        if existing:
            existing.password_hash = hash_password(password)
            existing.role = "admin"
            existing.status = "active"
            if name:
                existing.name = name
            await db.commit()
            print(f"✓ 已更新用户 {email} 为管理员")
        else:
            user = User(
                email=email,
                name=name,
                password_hash=hash_password(password),
                role="admin",
                status="active",
            )
            db.add(user)
            await db.commit()
            print(f"✓ 已创建管理员 {email}（昵称：{name}）")


def main():
    parser = argparse.ArgumentParser(description="创建管理员用户")
    parser.add_argument("--email", required=True, help="邮箱地址")
    parser.add_argument("--password", required=True, help="密码（至少8位）")
    parser.add_argument("--name", default="管理员", help="昵称（默认：管理员）")
    args = parser.parse_args()

    if len(args.password) < 8:
        print("错误：密码至少需要8位")
        sys.exit(1)

    asyncio.run(create_admin(args.email, args.password, args.name))


if __name__ == "__main__":
    main()
