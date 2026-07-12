
import React from 'react';

interface LoadingComponentProps {
  stage: string;
  progress: number;
  /** Keep visible while scrolling company preview content during long-running analysis. */
  sticky?: boolean;
}

export const LoadingComponent: React.FC<LoadingComponentProps> = ({ stage, progress, sticky = false }) => {
  return (
    <div
      className={`w-full max-w-2xl mx-auto my-8 p-6 bg-gray-800 rounded-lg shadow-md fade-in ${
        sticky ? 'sticky top-20 z-10 border border-gray-700/80 backdrop-blur-sm' : ''
      }`}
    >
      <div className="flex justify-between items-center mb-2">
        <p className="text-sm font-medium text-blue-300">{stage}</p>
        <p className="text-sm font-semibold text-gray-200">{Math.round(progress)}%</p>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2.5">
        <div
          className="bg-blue-500 h-2.5 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};
