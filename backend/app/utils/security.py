from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
import bcrypt
import asyncio
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os, secrets
from app.config import settings

# ─── 密码 ───────────────────────────────────────────────
_BCRYPT_ROUNDS = 10

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(_BCRYPT_ROUNDS)).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

async def verify_password_async(plain: str, hashed: str) -> bool:
    return await asyncio.to_thread(verify_password, plain, hashed)

# ─── JWT ────────────────────────────────────────────────
def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    """Raises JWTError if invalid/expired."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])

# ─── AES-GCM（加密用户 LLM API Key）───────────────────
def _get_aes_key() -> bytes:
    key_hex = settings.ENCRYPTION_KEY
    if not key_hex:
        raise RuntimeError("ENCRYPTION_KEY not set in environment")
    return bytes.fromhex(key_hex)

def encrypt_api_key(plain_key: str) -> bytes:
    """返回 nonce(12) + ciphertext，存入数据库 BYTEA。"""
    aesgcm = AESGCM(_get_aes_key())
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plain_key.encode(), None)
    return nonce + ct

def decrypt_api_key(encrypted: bytes) -> str:
    aesgcm = AESGCM(_get_aes_key())
    nonce, ct = encrypted[:12], encrypted[12:]
    return aesgcm.decrypt(nonce, ct, None).decode()

def make_key_hint(key: str) -> str:
    """显示给用户的脱敏提示，如 sk-PxABsMKg****A9lf。"""
    if len(key) <= 12:
        return "****"
    return f"{key[:8]}****{key[-4:]}"
