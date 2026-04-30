from pydantic import BaseModel, EmailStr, Field

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    name: str
    role: str

class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)

class UpdateLLMKeyRequest(BaseModel):
    api_key: str = Field(min_length=10)

class UserMeResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    avatar_url: str | None
    llm_api_key_hint: str | None
    llm_api_key_status: str

    model_config = {"from_attributes": True}
