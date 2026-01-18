
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// Error boundary to catch initialization errors
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Application error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-red-900/20 border border-red-500 rounded-lg p-6">
            <h1 className="text-2xl font-bold text-red-400 mb-4">Application Error</h1>
            <p className="text-red-300 mb-4">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <div className="bg-gray-800 p-4 rounded mt-4">
              <p className="text-sm text-gray-400 mb-2">Possible solutions:</p>
              <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                <li>For browser environments, set VITE_API_KEY environment variable</li>
                <li>For server environments, ensure Application Default Credentials are configured</li>
                <li>Run: gcloud auth application-default login</li>
                <li>Check browser console for more details</li>
              </ul>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
