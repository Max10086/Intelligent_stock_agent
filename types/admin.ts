export interface AdminMetricsResponse {
  period: { from: string; to: string };
  growth: {
    signups: number;
    activatedInPeriod: number;
    wau: number;
  };
  revenue: {
    newPaidUsers: number;
    totalPaidUsers: number;
    conversionRate: number;
  };
  usage: {
    totalAnalyses: number;
    analysesInPeriod: number;
    avgAnalysesPerUser: number;
    topTickers: Array<{ ticker: string; count: number }>;
  };
  funnel: {
    registered: number;
    activated: number;
    hitPaywall: number;
    paid: number;
  };
  trends: {
    signupsByDay: Array<{ date: string; count: number }>;
    paidByDay: Array<{ date: string; count: number }>;
    analysesByDay: Array<{ date: string; count: number }>;
  };
}

export interface AdminUserRow {
  id: string;
  email: string;
  createdAt: string;
  firstAnalysisAt: string | null;
  paidAt: string | null;
  isPaid: boolean;
  isAdmin: boolean;
  totalAnalyses: number;
  lastActiveAt: string | null;
}

export interface AdminUsersResponse {
  total: number;
  skip: number;
  limit: number;
  users: AdminUserRow[];
}

export interface AdminFeedbackItem {
  id: string;
  userId: string;
  userEmail: string;
  userIsPaid: boolean;
  category: string;
  message: string;
  rating: number | null;
  context: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminFeedbackResponse {
  items: AdminFeedbackItem[];
}
