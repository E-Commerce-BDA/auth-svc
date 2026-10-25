export interface UserRow {
    id: string
    password_hash: string
    first_name: string
    last_name: string
    email: string
    phone: string | null
    avatar_url: string | null
    status: 'active' | 'disabled' | 'pending'
    last_login_at: Date | null
    created_at: Date
    updated_at: Date
}

export interface RoleRow {
    id: string
    name: string
    slug: string
    description: string | null
    created_at: Date
    updated_at: Date
}

export interface RefreshTokenRow {
    id: string
    user_id: string
    family_id: string
    token_hash: string
    expires_at: Date
    revoked_at: Date | null
    created_at: Date
}