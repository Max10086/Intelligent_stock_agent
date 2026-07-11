import React from 'react';
import type { Language } from '../types.ts';
import { getUIText } from '../constants.ts';

type BrandMarkVariant = 'hero' | 'header' | 'login';

interface BrandMarkProps {
  language: Language;
  variant: BrandMarkVariant;
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ language, variant, className = '' }) => {
  const ui = getUIText(language);

  if (variant === 'hero') {
    return (
      <div className={`text-center ${className}`}>
        <h1 className="text-4xl font-extrabold text-white sm:text-5xl lg:text-6xl tracking-tight">
          {ui.brandName}
        </h1>
        <div className="mt-4 sm:mt-5 px-2">
          <p className="inline-flex items-baseline whitespace-nowrap gap-x-2.5 text-xl sm:text-2xl text-gray-400 leading-relaxed">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-sky-300 to-cyan-300 drop-shadow-[0_0_18px_rgba(56,189,248,0.35)]">
              {ui.productSubtitle}
            </span>
            <span className="text-gray-600 font-light" aria-hidden="true">
              ·
            </span>
            <span className="font-normal text-gray-300/90">{ui.searchSubtitle}</span>
          </p>
        </div>
      </div>
    );
  }

  if (variant === 'login') {
    return (
      <div className={`text-center ${className}`}>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          {ui.brandName}
        </h1>
        <div className="mt-3 sm:mt-4 px-1">
          <p className="text-xl sm:text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-sky-300 to-cyan-300 drop-shadow-[0_0_18px_rgba(56,189,248,0.35)]">
            {ui.productSubtitle}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`leading-tight ${className}`}>
      <span className="block text-base sm:text-lg font-bold text-gray-100 tracking-tight">
        {ui.brandName}
      </span>
      <span className="hidden md:block text-[11px] text-gray-400 font-medium">
        {ui.productSubtitle}
      </span>
    </div>
  );
};
