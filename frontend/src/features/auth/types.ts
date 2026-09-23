// Authentication request/response shapes.

export interface LoginResponse {
  token: string;
  user: {
    id: number;
    username: string;
    role: string;
  };
  passwordNeedChange: boolean;
}

export interface RefreshResponse {
  token: string;
  user: {
    id: number;
    username: string;
    role: string;
  };
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * A listener's own client settings, stored against the account so they
 * follow the person to any browser they sign in on. A field is absent
 * when it has never been set, which is not the same as a chosen value.
 */
export interface ListenerPreferences {
  keypadBeeps?: string;
}
