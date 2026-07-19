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
  subscriptionStatus?: string | null;
  hasSubscription?: boolean;
  createdAt: string;
}

export interface UsageSummary {
  usageDate: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  tier: 'free' | 'locked' | 'paid' | 'admin';
  /** End of the 72-hour free window (signup + 72h). */
  freeEndsAt: string | null;
  /** @deprecated Use freeEndsAt — kept for older UI code. */
  trialEndsAt: string | null;
  /** Analyses consumed since signup while on the free tier. */
  totalFreeUsed?: number;
  freeAnalysisLimit?: number;
  requiresUpgrade?: boolean;
  isPaid: boolean;
  isAdmin: boolean;
}

export interface SubscriptionSummary {
  isPaid: boolean;
  paidUntil: string | null;
  hasSubscription: boolean;
  subscriptionStatus: string | null;
  /** ISO timestamp from PayPal billing_info.next_billing_time */
  nextBillingAt: string | null;
}

export type AnalyticsEventType =
  | 'login'
  | 'logout'
  | 'signup_complete'
  | 'page_view'
  | 'analysis_start'
  | 'analysis_complete'
  | 'first_analysis'
  | 'candidate_analysis_start'
  | 'follow_up_start'
  | 'batch_start'
  | 'compare_start'
  | 'compare_complete'
  | 'history_open'
  | 'report_open'
  | 'usage_limit_hit'
  | 'search_submit'
  | 'paywall_shown'
  | 'paywall_dismissed'
  | 'subscription_activated'
  | 'subscription_cancelled'
  | 'report_feedback'
  | 'gainer_manual_analyze'
  | 'gainer_auto_analyze'
  | 'gainer_auto_analyze_skipped'
  | 'gainer_manual_fetch';

export type FeedbackCategory = 'bug' | 'feature' | 'quality' | 'pricing' | 'other';

export interface FeedbackPayload {
  category: FeedbackCategory;
  message: string;
  rating?: number;
  context?: Record<string, unknown>;
}
