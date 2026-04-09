export type SubjectCategory = "humanities" | "sciences" | "languages" | "stem";

export interface Subject {
  id: string;
  name: string;
  icon: string;
  category: SubjectCategory;
  supportsVisuals: boolean;
  description: string;
  color: string;
}

export const subjects: Subject[] = [
  // Humanities — full visual support
  { id: "english", name: "English", icon: "📖", category: "humanities", supportsVisuals: true, description: "Literature, novels, poetry & comprehension", color: "hsl(168 60% 38%)" },
  { id: "history", name: "History", icon: "🏛️", category: "humanities", supportsVisuals: true, description: "Historical events, timelines & analysis", color: "hsl(14 90% 62%)" },
  { id: "geography", name: "Geography", icon: "🌍", category: "humanities", supportsVisuals: true, description: "Maps, environments & earth systems", color: "hsl(145 60% 42%)" },
  { id: "life-sciences", name: "Life Sciences", icon: "🧬", category: "sciences", supportsVisuals: true, description: "Biology, ecosystems & living systems", color: "hsl(260 55% 58%)" },
  { id: "art", name: "Visual Arts", icon: "🎨", category: "humanities", supportsVisuals: true, description: "Art history, techniques & visual studies", color: "hsl(330 65% 55%)" },
  { id: "music", name: "Music", icon: "🎵", category: "humanities", supportsVisuals: true, description: "Music theory, history & appreciation", color: "hsl(38 92% 50%)" },
  
  // Languages — visual support
  { id: "afrikaans", name: "Afrikaans", icon: "🇿🇦", category: "languages", supportsVisuals: true, description: "Afrikaans literature & language study", color: "hsl(200 60% 45%)" },
  { id: "isizulu", name: "isiZulu", icon: "🇿🇦", category: "languages", supportsVisuals: true, description: "isiZulu literature & language study", color: "hsl(120 50% 40%)" },
  { id: "french", name: "French", icon: "🇫🇷", category: "languages", supportsVisuals: true, description: "French literature & language study", color: "hsl(220 70% 50%)" },

  // STEM — NO visual support
  { id: "mathematics", name: "Mathematics", icon: "📐", category: "stem", supportsVisuals: false, description: "Algebra, geometry, calculus & statistics", color: "hsl(200 50% 45%)" },
  { id: "physical-sciences", name: "Physical Sciences", icon: "⚛️", category: "stem", supportsVisuals: false, description: "Physics & chemistry fundamentals", color: "hsl(180 40% 40%)" },
  { id: "accounting", name: "Accounting", icon: "📊", category: "stem", supportsVisuals: false, description: "Financial accounting & business studies", color: "hsl(220 30% 45%)" },
  { id: "computer-science", name: "Computer Science", icon: "💻", category: "stem", supportsVisuals: false, description: "Programming, algorithms & IT", color: "hsl(250 45% 50%)" },
];

export const getSubjectById = (id: string) => subjects.find(s => s.id === id);
export const getSubjectsByCategory = (cat: SubjectCategory) => subjects.filter(s => s.category === cat);
export const getVisualsSubjects = () => subjects.filter(s => s.supportsVisuals);
