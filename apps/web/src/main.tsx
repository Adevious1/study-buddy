import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { ApiError } from './data';
import { ChildProfileProvider } from './state/ChildProfileContext';
import { initWebSentry } from './observability/sentry';
import App from './App';

initWebSentry();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign('/login');
        return;
      }
      // Breadcrumb only: the server already captures its own 500s; a second
      // client-side event per failed request would just be noise. Static
      // messages only — a dynamic err.message could carry child data.
      Sentry.addBreadcrumb({
        category: 'query',
        level: 'warning',
        message: err instanceof ApiError ? `API ${err.status}` : 'query error',
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ChildProfileProvider>
        <App />
      </ChildProfileProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
