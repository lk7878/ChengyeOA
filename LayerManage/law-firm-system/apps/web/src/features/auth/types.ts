export interface LoginUser {
  id: string;
  username: string;
  name: string;
  roles: string[];
  permissions: string[];
}

export interface AuthenticatedData {
  mode: 'AUTHENTICATED';
  token: string;
  csrfToken: string;
  expiresIn: 900;
  user: LoginUser;
  recoveryCodes?: string[];
}

export type LoginData =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | { mode: 'MFA_ENROLLMENT_REQUIRED'; challengeToken: string; expiresIn: 600 }
  | { mode: 'MFA_CHALLENGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | AuthenticatedData;

export type StepUpPurpose =
  | 'ADMIN_GOVERNANCE_CREATE'
  | 'ADMIN_GOVERNANCE_APPROVE'
  | 'ADMIN_GOVERNANCE_RETRY'
  | 'EVENT_DELIVERY_RETRY'
  | 'MFA_DISABLE_SELF'
  | 'MFA_RECOVERY_CODES_REGENERATE'
  | 'ADMIN_MFA_RESET'
  | 'SESSION_REVOKE'
  | 'SESSION_REVOKE_ALL'
  | 'REFUND_APPROVE';

export interface MfaStatusView {
  enabled: boolean;
  verifiedAt: string | null;
  recoveryCodesRemaining: number;
}

export interface SessionView {
  id: string;
  assuranceLevel: 'PASSWORD' | 'MFA';
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
  ipPrefix: string | null;
}
