import narration from "@/assets/macbeth-act-1-scene-1.mp3.asset.json";

// Curated factual questions from Macbeth Act I (Project Gutenberg ebook 1533).
// This public sample is separate from the private, reviewed quiz bank.
export const macbethPreviewQuiz = [
  {
    question: "Where do the three witches agree to meet Macbeth?",
    options: ["Upon the heath", "Inside Duncan’s castle", "In a forest", "At a harbour"],
    correctIndex: 0,
    explanation: "In Act I, Scene I, the second witch says ‘Upon the heath’, and the third adds ‘There to meet with Macbeth.’",
  },
  {
    question: "Which new title does King Duncan give Macbeth after the battle?",
    options: ["Prince of Cumberland", "Thane of Fife", "Thane of Cawdor", "King of Scotland"],
    correctIndex: 2,
    explanation: "In Act I, Scene II, Duncan gives Macbeth the title Thane of Cawdor after the previous thane’s treachery. Macbeth is already Thane of Glamis.",
  },
  {
    question: "What do the witches predict about Banquo’s descendants?",
    options: ["They will leave Scotland forever", "They will become kings", "They will serve as Duncan’s guards", "They will become witches"],
    correctIndex: 1,
    explanation: "In Act I, Scene III, the witches tell Banquo ‘Thou shalt get kings, though thou be none’: his descendants will be kings, although he will not be one.",
  },
  {
    question: "Whom does Duncan name Prince of Cumberland and heir to his throne?",
    options: ["Banquo", "Donalbain", "Macbeth", "Malcolm"],
    correctIndex: 3,
    explanation: "In Act I, Scene IV, Duncan names his eldest son Malcolm Prince of Cumberland. Macbeth sees Malcolm’s succession as an obstacle to becoming king.",
  },
  {
    question: "At the end of Act I, what do Macbeth and Lady Macbeth plan to do?",
    options: ["Tell Duncan about the witches", "Escape to England", "Kill Duncan and blame his guards", "Ask Banquo to become king"],
    correctIndex: 2,
    explanation: "In Act I, Scene VII, Lady Macbeth plans to drug Duncan’s guards and blame them for his murder. Macbeth agrees to carry out the plan; the murder has not happened yet.",
  },
] as const;

export function scoreMacbethPreview(answers: readonly (number | null)[]): number {
  return macbethPreviewQuiz.reduce((score, question, index) =>
    score + (answers[index] === question.correctIndex ? 1 : 0), 0);
}

// Public-domain text: Shakespeare, Macbeth, Project Gutenberg ebook 1533.
// Audio: existing English Gemini/Charon seed, chunk 0, clipped at the scene break.
export const macbethPreview = {
  documentId: "41eaa47e-de49-46d1-a3ed-829aea4b9e98",
  title: "Macbeth",
  scene: "Act I, Scene I — An open place",
  audioUrl: narration.url,
  excerpt: `FIRST WITCH:
When shall we three meet again?
In thunder, lightning, or in rain?

SECOND WITCH:
When the hurlyburly’s done,
When the battle’s lost and won.

THIRD WITCH:
That will be ere the set of sun.

FIRST WITCH:
Where the place?

SECOND WITCH:
Upon the heath.

THIRD WITCH:
There to meet with Macbeth.

FIRST WITCH:
I come, Graymalkin!

SECOND WITCH:
Paddock calls.

THIRD WITCH:
Anon.

ALL:
Fair is foul, and foul is fair:
Hover through the fog and filthy air.`,
};