import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PipColorProvider } from './state/PipColorContext';
import { AppLayout } from './routes/app/AppLayout';
import { HomeRoute } from './routes/app/HomeRoute';
import { LibraryRoute } from './routes/app/LibraryRoute';
import { ProfileRoute } from './routes/app/ProfileRoute';
import { VoiceRoute } from './routes/app/VoiceRoute';
import { RecapRoute } from './routes/app/RecapRoute';
import { DashboardRoute } from './routes/dashboard/DashboardRoute';
import { LoginRoute } from './routes/auth/LoginRoute';
import { OnboardingRoute } from './routes/onboarding/OnboardingRoute';
import { SwitchRoute } from './routes/onboarding/SwitchRoute';
import { RequireGuardian } from './routes/auth/RequireGuardian';
import { RequireDashboardPin } from './routes/auth/RequireDashboardPin';

export default function App() {
  return (
    <PipColorProvider initial="coral">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/onboarding"
            element={
              <RequireGuardian>
                <OnboardingRoute />
              </RequireGuardian>
            }
          />
          <Route
            path="/switch"
            element={
              <RequireGuardian>
                <SwitchRoute />
              </RequireGuardian>
            }
          />
          <Route
            path="/app"
            element={
              <RequireGuardian>
                <AppLayout />
              </RequireGuardian>
            }
          >
            <Route index element={<HomeRoute />} />
            <Route path="subjects" element={<LibraryRoute />} />
            <Route path="me" element={<ProfileRoute />} />
            <Route path="voice" element={<VoiceRoute />} />
            <Route path="recap" element={<RecapRoute />} />
          </Route>
          <Route
            path="/dashboard"
            element={
              <RequireGuardian>
                <RequireDashboardPin>
                  <DashboardRoute />
                </RequireDashboardPin>
              </RequireGuardian>
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </PipColorProvider>
  );
}
