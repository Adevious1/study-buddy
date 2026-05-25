import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PipColorProvider } from './state/PipColorContext';
import { AppLayout } from './routes/app/AppLayout';
import { HomeRoute } from './routes/app/HomeRoute';
import { LibraryRoute } from './routes/app/LibraryRoute';
import { ProfileRoute } from './routes/app/ProfileRoute';
import { VoiceRoute } from './routes/app/VoiceRoute';
import { RecapRoute } from './routes/app/RecapRoute';
import { DashboardRoute } from './routes/dashboard/DashboardRoute';

export default function App() {
  return (
    <PipColorProvider initial="coral">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<HomeRoute />} />
            <Route path="subjects" element={<LibraryRoute />} />
            <Route path="me" element={<ProfileRoute />} />
            <Route path="voice" element={<VoiceRoute />} />
            <Route path="recap" element={<RecapRoute />} />
          </Route>
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </PipColorProvider>
  );
}
