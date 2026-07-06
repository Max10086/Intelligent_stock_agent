export interface AuthUser {
  id: string;
  email: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isPaid: boolean;
  isAdmin: boolean;
  paidUntil: string | null;
  createdAt: string;
}

export interface UsageSummary {
  usageDate: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  tier: 'trial' | 'standard' | 'paid' | 'admin';
  trialEndsAt: string | null;
  isPaid: boolean;
  isAdmin: boolean;
}

export type AnalyticsEventType =
  | 'login'
  | 'logout'
  | 'page_view'
  | 'analysis_start'
  | 'analysis_complete'
  | 'candidate_analysis_start'
  | 'follow_up_start'
  | 'compare_start'
  | 'compare_complete'
  | 'history_open'
  | 'report_open'
  | 'usage_limit_hit'
  | 'search_submit';
