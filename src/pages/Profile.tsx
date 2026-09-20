import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { User, Globe, BookOpen, TrendingUp, Pencil, Loader2, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AppLayout from "@/components/AppLayout";
import ProgressionPanel from "@/components/ProgressionPanel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getSubjectById, subjects } from "@/lib/subjects";

const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
  "Mpumalanga", "Northern Cape", "North West", "Western Cape",
];

type ProfileRow = {
  display_name: string | null;
  grade: string | null;
  school: string | null;
  city: string | null;
  province: string | null;
  preferred_language: string | null;
  selected_subjects: string[] | null;
};

const EMPTY: ProfileRow = {
  display_name: "", grade: "", school: "", city: "", province: "",
  preferred_language: "en", selected_subjects: [],
};

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<ProfileRow>(EMPTY);
  const [form, setForm] = useState<ProfileRow>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [editingSubjects, setEditingSubjects] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, grade, school, city, province, preferred_language, selected_subjects")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row: ProfileRow = { ...EMPTY, ...data };
        setProfile(row);
        setForm(row);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const set = (key: keyof ProfileRow, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async (fields: Partial<ProfileRow>, done?: () => void) => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update(fields).eq("user_id", user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    setProfile((p) => ({ ...p, ...fields }));
    toast({ title: "Saved" });
    done?.();
  };

  const savePersonal = () => {
    const name = (form.display_name ?? "").trim();
    if (!name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    save({
      display_name: name,
      grade: (form.grade ?? "").trim() || null,
      school: (form.school ?? "").trim() || null,
      city: (form.city ?? "").trim() || null,
      province: form.province || null,
    }, () => setEditing(false));
  };

  const toggleSubject = (id: string) =>
    setSubjectDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const saveSubjects = () =>
    save({ selected_subjects: subjectDraft }, () => setEditingSubjects(false));

  const subjectNames = (profile.selected_subjects ?? []).map((id) => {
    const s = getSubjectById(id);
    return s ? `${s.icon} ${s.name}` : id;
  });

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-6">Profile</h1>

        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <ProgressionPanel />
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display font-semibold flex items-center gap-2">
                    <User className="w-4 h-4" /> Personal Info
                  </h2>
                  {!editing && (
                    <Button size="sm" variant="outline" onClick={() => { setForm(profile); setEditing(true); }}>
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                  )}
                </div>

                {loading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </div>
                ) : editing ? (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <Label>Full Name</Label>
                        <Input value={form.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} className="mt-1" />
                      </div>
                      <div>
                        <Label>Grade</Label>
                        <Input value={form.grade ?? ""} onChange={(e) => set("grade", e.target.value)} placeholder="e.g. Grade 10" className="mt-1" />
                      </div>
                      <div>
                        <Label>School</Label>
                        <Input value={form.school ?? ""} onChange={(e) => set("school", e.target.value)} placeholder="e.g. Greenfield High" className="mt-1" />
                      </div>
                      <div>
                        <Label>City / Town</Label>
                        <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Polokwane" className="mt-1" />
                      </div>
                      <div>
                        <Label>Province</Label>
                        <Select value={form.province ?? ""} onValueChange={(v) => set("province", v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select province" /></SelectTrigger>
                          <SelectContent>
                            {PROVINCES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={savePersonal} disabled={saving}>
                        {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save Changes
                      </Button>
                      <Button variant="ghost" onClick={() => { setForm(profile); setEditing(false); }}>Cancel</Button>
                    </div>
                  </>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4 text-sm">
                    {[
                      { label: "Full Name", value: profile.display_name },
                      { label: "Grade", value: profile.grade },
                      { label: "School", value: profile.school },
                      { label: "City / Town", value: profile.city },
                      { label: "Province", value: profile.province },
                    ].map((f) => (
                      <div key={f.label}>
                        <p className="text-muted-foreground text-xs">{f.label}</p>
                        <p className="font-medium mt-0.5">{f.value || "—"}</p>
                      </div>
                    ))}
                  </div>
                )}
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
                    <Select
                      value={profile.preferred_language ?? "en"}
                      onValueChange={(v) => save({ preferred_language: v })}
                    >
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="af">Afrikaans</SelectItem>
                        <SelectItem value="zu">isiZulu</SelectItem>
                        <SelectItem value="xh">isiXhosa</SelectItem>
                        <SelectItem value="nso">Sepedi</SelectItem>
                        <SelectItem value="tn">Setswana</SelectItem>
                        <SelectItem value="ts">Xitsonga</SelectItem>
                        <SelectItem value="ve">Tshivenda</SelectItem>
                        <SelectItem value="nr">isiNdebele</SelectItem>
                        <SelectItem value="st">Sesotho</SelectItem>
                        <SelectItem value="ss">siSwati</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
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
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h2 className="font-display font-semibold flex items-center gap-2">
                    <BookOpen className="w-4 h-4" /> My Subjects
                  </h2>
                  {!editingSubjects ? (
                    <Button size="sm" variant="outline" onClick={() => {
                      setSubjectDraft(profile.selected_subjects ?? []);
                      setEditingSubjects(true);
                    }}>
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                  ) : null}
                </div>

                {editingSubjects ? (
                  <>
                    <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                      {subjects.map((s) => {
                        const active = subjectDraft.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleSubject(s.id)}
                            className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              active ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                            }`}
                          >
                            <span>{s.icon} {s.name}</span>
                            {active && <Check className="w-4 h-4 text-primary shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2 pt-4">
                      <Button size="sm" onClick={saveSubjects} disabled={saving}>
                        {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />} Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingSubjects(false)} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    {subjectNames.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No subjects selected yet.</p>
                    ) : subjectNames.map(s => (
                      <div key={s} className="text-sm py-1.5">{s}</div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
