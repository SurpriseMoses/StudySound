import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import Index from "./pages/Index";
import Preview from "./pages/Preview";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Subjects from "./pages/Subjects";
import UploadPage from "./pages/UploadPage";
import LessonPlayer from "./pages/LessonPlayer";
import LibraryPage from "./pages/LibraryPage";
import Plans from "./pages/Plans";
import TopUp from "./pages/TopUp";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminOverview from "./pages/admin/AdminOverview";
import AdminDocuments from "./pages/admin/AdminDocuments";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminErrors from "./pages/admin/AdminErrors";
import AdminEconomy from "./pages/admin/AdminEconomy";
import AdminAbuse from "./pages/admin/AdminAbuse";
import AdminTopDocuments from "./pages/admin/AdminTopDocuments";
import AdminSeedAudio from "./pages/admin/AdminSeedAudio";
import AdminSeedTranslations from "./pages/admin/AdminSeedTranslations";
import AdminPipeline from "./pages/admin/AdminPipeline";
import AdminSeedingStatus from "./pages/admin/AdminSeedingStatus";
import AdminVisuals from "./pages/admin/AdminVisuals";
import AdminIngestion from "./pages/admin/AdminIngestion";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const protect = (el: React.ReactNode) => <ProtectedRoute>{el}</ProtectedRoute>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<Index />} />
            <Route path="/preview" element={<Preview />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/plans" element={<Plans />} />

            {/* Protected */}
            <Route path="/onboarding" element={protect(<Onboarding />)} />
            <Route path="/dashboard" element={protect(<Dashboard />)} />
            <Route path="/subjects" element={protect(<Subjects />)} />
            <Route path="/upload" element={protect(<UploadPage />)} />
            <Route path="/lesson/:documentId" element={protect(<LessonPlayer />)} />
            <Route path="/library" element={protect(<LibraryPage />)} />
            <Route path="/profile" element={protect(<Profile />)} />
            <Route path="/topup" element={protect(<TopUp />)} />

            {/* Admin */}
            <Route
              path="/admin"
              element={protect(<AdminRoute><AdminLayout /></AdminRoute>)}
            >
              <Route index element={<AdminOverview />} />
              <Route path="documents" element={<AdminDocuments />} />
              <Route path="top-documents" element={<AdminTopDocuments />} />
              <Route path="pipeline" element={<AdminPipeline />} />
              <Route path="seeding-status" element={<AdminSeedingStatus />} />
              <Route path="seed-audio" element={<AdminSeedAudio />} />
              <Route path="seed-translations" element={<AdminSeedTranslations />} />
              <Route path="visuals" element={<AdminVisuals />} />
              <Route path="ingestion" element={<AdminIngestion />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="economy" element={<AdminEconomy />} />
              <Route path="abuse" element={<AdminAbuse />} />
              <Route path="errors" element={<AdminErrors />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
