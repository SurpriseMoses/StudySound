import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import TryRealLesson from "@/components/landing/TryRealLesson";
import HowItWorks from "@/components/landing/HowItWorks";
import ValueSection from "@/components/landing/ValueSection";
import PricingSection from "@/components/landing/PricingSection";
import FinalCta from "@/components/landing/FinalCta";
import ClientLeadSection from "@/components/landing/ClientLeadSection";
import LandingFooter from "@/components/landing/LandingFooter";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <HeroSection />
      <TryRealLesson />
      <HowItWorks />
      <ValueSection />
      <PricingSection />
      <FinalCta />
      <ClientLeadSection />
      <LandingFooter />
    </div>
  );
}
