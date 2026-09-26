import { Link } from "react-router-dom";
import LegalPage from "@/components/LegalPage";

export default function Support() {
  return (
    <LegalPage
      title="Help & Support"
      updated="26 September 2026"
      sections={[
        {
          title: "Get in touch",
          body: [
            "Questions about your account, credits, payments, or something that isn't working? Email us and we'll investigate.",
            "Support email: support@studysound.co.za (placeholder — will be replaced with the official StudySound support address).",
            "Please include the email you signed up with and a short description of the problem. Screenshots help.",
          ],
        },
        {
          title: "Common topics",
          body: [
            "Credits or payments: tell us the date and amount, and what you were trying to do.",
            "Content problems: name the book, chapter or quiz question — you can also use \"Report a problem\" on any quiz question.",
            "Audio, translations or visuals marked \"not available yet\" are still being prepared and will appear automatically.",
          ],
        },
        {
          title: "Response time",
          body: ["We aim to reply within 2 school days. Payment problems are prioritised."],
        },
      ]}
    />
  );
}
