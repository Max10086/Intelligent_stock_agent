
import React from 'react';

interface LoadingComponentProps {
  stage: string;
  progress: number;
}

export const LoadingComponent: React.FC<LoadingComponentProps> = ({ stage, progress }) => {
  return (
    <div className="w-full max-w-2xl mx-auto my-8 p-6 bg-gray-800 rounded-lg shadow-md fade-in">
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
