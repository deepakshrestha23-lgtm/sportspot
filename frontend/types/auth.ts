export type UserRole = "PLAYER" | "COURT_OWNER" | "ADMIN";

export interface User {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
  is_staff: boolean;
  date_joined: string;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: Exclude<UserRole, "ADMIN">;
}
