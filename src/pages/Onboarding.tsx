import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, BookOpen, Upload, CreditCard, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { subjects } from "@/lib/subjects";

const steps = ["Account", "Subjects", "Plan"];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>("essential");

  const toggleSubject = (id: string) => {
    setSelectedSubjects(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleComplete = () => {
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Sparkles className="w-6 h-6 text-primary" />
            <span className="font-display text-xl font-bold">StudySound</span>
          </div>
          {/* Progress */}
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
                <CardContent className="p-6 space-y-4">
                  <h2 className="font-display text-xl font-bold">Create your account</h2>
                  <div className="space-y-3">
                    <div>
                      <Label>Full Name</Label>
                      <Input placeholder="e.g. Thabo Mokoena" className="mt-1" />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input type="email" placeholder="learner@school.co.za" className="mt-1" />
                    </div>
                    <div>
                      <Label>Password</Label>
                      <Input type="password" placeholder="Create a password" className="mt-1" />
                    </div>
                    <div>
                      <Label>Grade</Label>
                      <Input placeholder="e.g. Grade 10" className="mt-1" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 1 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="font-display text-xl font-bold mb-1">Choose your subjects</h2>
                  <p className="text-sm text-muted-foreground mb-4">Select the subjects you're studying</p>
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

            {step === 2 && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="font-display text-xl font-bold mb-4">Choose your plan</h2>
                  <div className="space-y-3">
                    {[
                      { id: "essential", name: "Essential", price: "R79/mo", desc: "Audio + quizzes" },
                      { id: "premium", name: "Premium", price: "R149/mo", desc: "Audio + visuals + quizzes" },
                    ].map(plan => (
                      <button
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan.id)}
                        className={`w-full p-4 rounded-lg border text-left transition-all ${
                          selectedPlan === plan.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-display font-semibold">{plan.name}</p>
                            <p className="text-sm text-muted-foreground">{plan.desc}</p>
                          </div>
                          <span className="font-display font-bold text-lg">{plan.price}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex justify-between mt-6">
          <Button variant="ghost" onClick={() => setStep(s => s - 1)} disabled={step === 0} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep(s => s + 1)} className="gap-2">
              Next <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleComplete} className="gap-2">
              Start Learning <Sparkles className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
