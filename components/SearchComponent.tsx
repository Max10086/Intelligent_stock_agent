import React, { useState } from 'react';
import { Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import { SearchIcon } from './icons.tsx';

interface SearchComponentProps {
  onSearch: (query: string) => void;
  // 移除了 onBatchSubmit，因为主页不再处理批量逻辑
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const SearchComponent: React.FC<SearchComponentProps> = ({ 
  onSearch, 
  language, 
  setLanguage 
}) => {
  const [query, setQuery] = useState('');
  // 移除了 isBatchMode 状态
  const uiText = getUIText(language);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 移除了分支判断，直接执行单次搜索
    if (query.trim()) {
      onSearch(query);
    }
  };

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'cn' : 'en');
  };

  return (
    <div className="max-w-2xl mx-auto text-center py-16 lg:py-24 fade-in">
      <h2 className="text-4xl font-extrabold text-white sm:text-5xl lg:text-6xl tracking-tight">
        {uiText.title}
      </h2>
      <p className="mt-4 text-lg text-gray-400">
        AI-powered insights for US, Hong Kong, and A-share markets.
      </p>
      <form onSubmit={handleSubmit} className="mt-10 max-w-xl mx-auto">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <SearchIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 text-lg bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder={uiText.searchPlaceholder} // 直接使用原来的占位符
            aria-label="Search query"
          />
        </div>
        
        {/* 移除了 Checkbox 区域 */}

        <div className="mt-6 flex justify-center items-center gap-4">
          <button
            type="submit"
            disabled={!query.trim()}
            className="px-8 py-3 text-lg font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-all transform hover:scale-105"
          >
            {uiText.searchButton} {/* 直接显示搜索按钮文本 */}
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            className="px-4 py-3 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors"
          >
            {uiText.languageToggle}
          </button>
        </div>
        
        {/* 移除了底部的提示文字 */}
      </form>
    </div>
  );
};