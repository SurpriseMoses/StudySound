import { motion } from "framer-motion";
import { User, Globe, BookOpen, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";
import ProgressionPanel from "@/components/ProgressionPanel";

export default function Profile() {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-6">Profile</h1>

        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <ProgressionPanel />
            <Card>
              <CardContent className="p-6 space-y-4">
                <h2 className="font-display font-semibold flex items-center gap-2">
                  <User className="w-4 h-4" /> Personal Info
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Full Name</Label>
                    <Input defaultValue="Thabo Mokoena" className="mt-1" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input defaultValue="thabo@school.co.za" className="mt-1" />
                  </div>
                  <div>
                    <Label>Grade</Label>
                    <Input defaultValue="Grade 10" className="mt-1" />
                  </div>
                  <div>
                    <Label>School</Label>
                    <Input defaultValue="Greenfield High" className="mt-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 space-y-4">
                <h2 className="font-display font-semibold flex items-center gap-2">
                  <Globe className="w-4 h-4" /> Language Settings
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Preferred Narration Language</Label>
                    <Select defaultValue="en">
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="af">Afrikaans</SelectItem>
                        <SelectItem value="zu">isiZulu</SelectItem>
                        <SelectItem value="xh">isiXhosa</SelectItem>
                        <SelectItem value="nso">Sepedi</SelectItem>
                        <SelectItem value="tn">Setswana</SelectItem>
                        <SelectItem value="ts">Xitsonga</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Voice Tone</Label>
                    <Select defaultValue="natural">
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="natural">Natural</SelectItem>
                        <SelectItem value="calm">Calm</SelectItem>
                        <SelectItem value="energetic">Energetic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button>Save Changes</Button>
              </CardContent>
            </Card>
          </div>

          {/* Stats */}
          <div className="space-y-5">
            <Card>
              <CardContent className="p-5">
                <h2 className="font-display font-semibold flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4" /> Learning Stats
                </h2>
                <div className="space-y-4">
                  {[
                    { label: "Lessons Completed", value: "12" },
                    { label: "Quizzes Taken", value: "8" },
                    { label: "Average Score", value: "78%" },
                    { label: "Study Streak", value: "5 days" },
                  ].map(stat => (
                    <div key={stat.label} className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">{stat.label}</span>
                      <span className="font-display font-semibold">{stat.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h2 className="font-display font-semibold flex items-center gap-2 mb-4">
                  <BookOpen className="w-4 h-4" /> My Subjects
                </h2>
                <div className="space-y-2">
                  {["📖 English", "🏛️ History", "🧬 Life Sciences"].map(s => (
                    <div key={s} className="text-sm py-1.5">{s}</div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
