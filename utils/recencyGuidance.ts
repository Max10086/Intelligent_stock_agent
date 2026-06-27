import type { Language } from '../types.ts';

const getLatestDisclosedQuarter = (date: Date) => {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month <= 4) return { year: year - 1, quarter: 4 };
  if (month <= 7) return { year, quarter: 1 };
  if (month <= 10) return { year, quarter: 2 };
  return { year, quarter: 3 };
};

export const buildRecencyGuidance = (date: Date, lang: Language = 'en'): string => {
  const today = date.toISOString().slice(0, 10);
  const { year: quarterYear, quarter } = getLatestDisclosedQuarter(date);
  const latestAnnualYear = date.getFullYear() - 1;
  const compareYear1 = latestAnnualYear - 1;
  const compareYear2 = latestAnnualYear - 2;

  if (lang === 'cn') {
    return `今天是 ${today}。
请严格按以下优先级采用最新信息：
1）最近 2–3 个月动态（新闻、公告、政策、重大事件）
2）${quarterYear}年Q${quarter} 最新披露季报/半年报数据
3）${latestAnnualYear} 年报 / FY${latestAnnualYear} 官方披露（最近完整年报）
4）${compareYear1}、${compareYear2} 年数据仅用于历史对比与趋势
若存在更新的权威数据，不得用旧数字下结论。
若找不到更新数据，须明确说明目前能查到的最新日期及原因。
关键论断须标注具体日期或期间（YYYY-MM 或 YYYY-Qx）。`;
  }

  return `Today is ${today}.
Prioritize the most recent information in this strict order:
1) The latest 2-3 months of updates (news, announcements, policy changes, major events)
2) ${quarterYear} Q${quarter} data and filings (latest disclosed quarter)
3) ${latestAnnualYear} annual report / FY${latestAnnualYear} official disclosures (latest complete annual report)
4) ${compareYear1} and ${compareYear2} only for historical comparison and trend context
When newer authoritative data exists, do NOT anchor conclusions on older numbers.
If newer data cannot be found, explicitly state the latest available date and why older data is used.
Always include concrete dates or periods (YYYY-MM or YYYY-Qx) in key claims.`;
};
