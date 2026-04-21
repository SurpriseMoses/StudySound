import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, ArrowLeft, Check, Loader2, MailCheck } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { subjects } from "@/lib/subjects";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const steps = ["Subjects", "Account"];

const emailSchema = z.string().trim().email("Invalid email address").max(255);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(72);
const nameSchema = z.string().trim().min(1, "Name is required").max(100);

export default function Onboarding() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);

  // Account form state
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const toggleSubject = (id: string) => {
    setSelectedSubjects(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleSignUp = async () => {
    const nameRes = nameSchema.safeParse(name);
    const emailRes = emailSchema.safeParse(email);
    const passRes = passwordSchema.safeParse(password);
    const firstError = [nameRes, emailRes, passRes].find(r => !r.success);
    if (firstError && !firstError.success) {
      toast({ title: "Invalid input", description: firstError.error.issues[0].message, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email: emailRes.data!,
      password: passRes.data!,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          full_name: nameRes.data,
          grade,
          selected_subjects: selectedSubjects,
        },
      },
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
      return;
    }
    setSentToEmail(emailRes.data!);
  };

  // Verification screen
  if (sentToEmail) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <MailCheck className="w-7 h-7 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold mb-2">Verify your email</h1>
          <p className="text-muted-foreground mb-6">
            We sent a verification link to <span className="font-medium text-foreground">{sentToEmail}</span>.
            Click the link to activate your free trial — 20 credits, no card required.
          </p>
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground space-y-2 text-left">
              <p>• Check your spam or promotions folder if you don't see it.</p>
              <p>• The link will sign you in and take you straight to your dashboard.</p>
            </CardContent>
          </Card>
          <Button variant="ghost" className="mt-6" onClick={() => navigate("/auth")}>
            Already verified? Sign in
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Sparkles className="w-6 h-6 text-primary" />
            <span className="font-display text-xl font-bold">StudySound</span>
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {i < step ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                {i < steps.length - 1 && <div className={`w-8 h-0.5 ${i < step ? "bg-primary" : "bg-muted"}`} />}
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{steps[step]}</p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {step === 0 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="font-display text-xl font-bold mb-1">Choose your subjects</h2>
                  <p className="text-sm text-muted-foreground mb-4">Select what you're studying — you can change this later.</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {subjects.map(subject => (
                      <button
                        key={subject.id}
                        onClick={() => toggleSubject(subject.id)}
                        className={`flex items-center gap-2.5 p-3 rounded-lg border text-left text-sm transition-all ${
                          selectedSubjects.includes(subject.id)
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        <span className="text-lg">{subject.icon}</span>
                        <div>
                          <p className="font-medium text-sm">{subject.name}</p>
                          {!subject.supportsVisuals && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Text + Quiz</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 1 && (
              <Card>
                <CardContent className="p-6 space-y-4">
                  <div>
                    <h2 className="font-display text-xl font-bold">Create your account</h2>
                    <p className="text-sm text-muted-foreground">Free trial • 20 credits • no card required</p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label>Full Name</Label>
                      <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Thabo Mokoena" className="mt-1" />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="learner@school.co.za" className="mt-1" />
                    </div>
                    <div>
                      <Label>Password</Label>
                      <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" className="mt-1" />
                    </div>
                    <div>
                      <Label>Grade</Label>
                      <Input value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. Grade 10" className="mt-1" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex justify-between mt-6">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? navigate("/") : setStep(s => s - 1))}
            className="gap-2"
            disabled={submitting}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          {step < steps.length - 1 ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              className="gap-2"
              disabled={step === 0 && selectedSubjects.length === 0}
            >
              Next <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleSignUp} className="gap-2" disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Create account
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
