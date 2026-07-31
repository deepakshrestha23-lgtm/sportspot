export type UserRole = "PLAYER" | "COURT_OWNER" | "ADMIN";

export interface User {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  email_verified: boolean;
  email_verified_at: string | null;
  is_active: boolean;
  is_staff: boolean;
  date_joined: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface RegisterResponse {
  user: User;
  verification_required: boolean;
  masked_email: string;
  expires_in: number;
  resend_available_in: number;
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: Exclude<UserRole, "ADMIN">;
  preferred_sport?: "CRICKSAL";
  skill_level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  location?: string;
}
