import LegalPage from "@/components/LegalPage";

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="26 September 2026"
      sections={[
        { title: "1. Agreement", body: ["By creating an account or using StudySound you agree to these terms. If you are under 18, your parent or guardian must agree on your behalf."] },
        { title: "2. The service", body: ["StudySound offers openly licensed textbooks, study guides and novels as readable lessons, narrated audio, translations into South African languages, visuals and practice quizzes.", "Quizzes are exam-style, CAPS-aligned practice. They are not predicted exam questions and do not guarantee any result. AI-assisted content is reviewed, but may contain mistakes — always check with your teacher and official materials."] },
        { title: "3. Your account", body: ["Keep your password safe and give accurate information. You are responsible for activity on your account. One account per person."] },
        { title: "4. Credits and subscriptions", body: ["Some features cost credits. Credits can be bought as once-off top-ups or received with a monthly plan. Prices and credit costs are shown before you confirm an action.", "Payments are processed by Paystack. Subscriptions renew monthly until cancelled. Credits have no cash value, cannot be transferred, and are non-refundable except where required by the Consumer Protection Act or other law.", "If something you paid credits for fails to generate, the credits are returned to your wallet."] },
        { title: "5. Acceptable use", body: ["Do not misuse the app: no automated scraping, abuse of free credits, sharing accounts, uploading content you have no right to, or attempting to break security. We may suspend accounts that break these rules."] },
        { title: "6. Content and licences", body: ["Books in the library are published under open licences (such as Creative Commons) or are in the public domain; attribution is shown with each book. Documents you upload remain yours; you confirm you are allowed to use them."] },
        { title: "7. Availability", body: ["We work to keep StudySound available but cannot promise it will always be uninterrupted or error-free. Some content may be marked \"not available yet\" while it is being prepared."] },
        { title: "8. Liability", body: ["To the extent allowed by law, StudySound is not liable for indirect losses arising from use of the app. Nothing in these terms limits your rights under the Consumer Protection Act."] },
        { title: "9. Changes and law", body: ["We may update these terms and will notify you of important changes. These terms are governed by the laws of the Republic of South Africa."] },
        { title: "10. Contact", body: ["Company and contact details will be added here."] },
      ]}
    />
  );
}
