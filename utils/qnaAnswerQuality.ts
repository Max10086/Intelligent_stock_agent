const UNUSABLE_SEARCH_ANSWER_PATTERNS = [
  /未能返回任何网络搜索结果/,
  /检索页面数为\s*0/,
  /无法获取.*所需的任何定量数据/,
  /No web results were returned/i,
  /returned no web results/i,
  /unable to retrieve any search results/i,
  /search results are insufficient/i,
  /必要数据完全缺失/,
  /lack(?:s)? factual basis/i,
];

export const isUnusableSearchAnswer = (answer: string | null | undefined): boolean => {
  const text = (answer || '').trim();
  if (!text) return true;
  return UNUSABLE_SEARCH_ANSWER_PATTERNS.some(pattern => pattern.test(text));
};
