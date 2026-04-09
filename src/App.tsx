import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/preview" element={<Preview />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/subjects" element={<Subjects />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/listen" element={<Listen />} />
          <Route path="/visuals" element={<Visuals />} />
          <Route path="/quiz" element={<Quiz />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
