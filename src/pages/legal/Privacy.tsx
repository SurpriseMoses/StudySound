import LegalPage from "@/components/LegalPage";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="26 September 2026"
      sections={[
        { title: "1. Who we are", body: ["StudySound (\"we\", \"us\") provides a learning app that turns South African school textbooks and novels into audio, translations, visuals and practice quizzes. We process personal information in line with the Protection of Personal Information Act, 2013 (POPIA). Our registered company name, address and Information Officer details will be published here."] },
        { title: "2. Information we collect", body: ["Account details: name, email address, password (stored encrypted), grade, school, city, province and chosen subjects.", "Learning activity: lessons opened, listening progress, quiz attempts and scores, streaks and XP.", "Payments: credit purchases and subscription status. Card details are handled by our payment provider, Paystack — we never see or store your full card number.", "Device information: basic technical data such as browser type, used to keep the app working and secure."] },
        { title: "3. Why we use it", body: ["To create and run your account, deliver lessons, track progress, process payments, prevent abuse, and improve the app. Province and city are used only for anonymous, grouped statistics (for example, how many learners use StudySound in Limpopo)."] },
        { title: "4. Learners under 18", body: ["Many of our users are high school learners. If you are under 18, a parent or guardian must agree to you using StudySound and to us processing your information. Parents or guardians may contact us at any time to view, correct or delete a child's information."] },
        { title: "5. Sharing", body: ["We do not sell your information. We share it only with service providers who help us run the app (hosting, payments, AI services that generate audio, translations and quizzes from textbook content), and only as needed. Your personal details are not sent to AI services — only book content is.", "We may disclose information if required by law."] },
        { title: "6. Storage and security", body: ["Your information is stored on secure cloud servers that may be located outside South Africa, with safeguards required by POPIA. Access is restricted and protected."] },
        { title: "7. Your rights", body: ["You may ask to access, correct or delete your information, object to processing, or withdraw consent. You can edit most details on your Profile page. You may also lodge a complaint with the Information Regulator of South Africa."] },
        { title: "8. Retention", body: ["We keep your information while your account is active and for as long as needed for legal, tax and payment records. Deleted accounts are removed within a reasonable period."] },
        { title: "9. Changes", body: ["We may update this policy and will notify you of important changes in the app."] },
        { title: "10. Contact", body: ["Contact details for privacy questions will be added here."] },
      ]}
    />
  );
}
