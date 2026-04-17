import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Preview from "./pages/Preview";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Subjects from "./pages/Subjects";
import UploadPage from "./pages/UploadPage";
import Listen from "./pages/Listen";
import Visuals from "./pages/Visuals";
import Quiz from "./pages/Quiz";
import LibraryPage from "./pages/LibraryPage";
import Plans from "./pages/Plans";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
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
            <Route path="/listen/:lessonId" element={protect(<Listen />)} />
            <Route path="/visuals" element={protect(<Visuals />)} />
            <Route path="/quiz" element={protect(<Quiz />)} />
            <Route path="/library" element={protect(<LibraryPage />)} />
            <Route path="/profile" element={protect(<Profile />)} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
