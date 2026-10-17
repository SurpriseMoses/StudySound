import LegalPage from "@/components/LegalPage";

export default function ReferralTerms() {
  return (
    <LegalPage
      title="Referral Programme Terms — Draft"
      updated="17 October 2026"
      sections={[
        { title: "1. Programme status and eligibility", body: [
          "These draft terms describe the proposed BrainGrasp Rewards programme. The programme is not yet active. South African consumer, privacy, tax and payment legal review is required before launch. No commission, discount, credit reward or payout is currently promised under this draft.",
          "Participants must provide accurate information and use one account per person. Participation and payout requirements for learners under 18, including parent or guardian consent, must be confirmed before activation.",
        ] },
        { title: "2. Referral attribution and privacy", body: [
          "A new learner may be attributed to one referrer using a valid referral link within the configured attribution window, initially 30 days. A later link does not replace an existing attribution. Signing up, verifying an email, signing in and checking out must preserve a valid attribution.",
          "Referral links must not contain private information. Referrers receive only limited, masked activity information, never another learner’s private payment records, subscription details or study activity. Link visits are tracked only where appropriate consent has been obtained.",
        ] },
        { title: "3. First-subscription discount", body: [
          "The proposed discount is 10% on the referred learner’s first eligible successful subscription payment: Essential R79 becomes R71.10, and Premium R149 becomes R134.10. The original price, discount and final amount must be displayed before payment.",
          "The discount does not apply to renewals, top-ups or additional accounts used to repeat the promotion. The final amount must match the payment provider’s confirmed transaction. Regular-price renewal timing and cancellation terms must be disclosed at checkout.",
        ] },
        { title: "4. Successful referrals and commission", body: [
          "A successful referral is a unique eligible new learner who completes their first confirmed paid subscription and passes the programme’s anti-fraud checks. Registration, link visits, free trials, failed or unpaid transactions and test payments are not successful referrals.",
          "The proposed one-time commission is 5% of the normal pre-discount subscription price: R3.95 for Essential or R7.45 for Premium. A different configured calculation basis must be disclosed before it applies. Renewals do not earn another commission. Rewards are conditional, not guaranteed income.",
          "Commissions may be pending while eligibility is reviewed. Available funds exclude pending, reserved, reversed and rejected amounts. Refunds, chargebacks, duplicate identities, self-referrals and fraud make payments ineligible; any financial reversal or offset must remain visible in the audit history rather than silently deleting an entry.",
        ] },
        { title: "5. Withdrawals and payout confirmation", body: [
          "The proposed minimum withdrawal is R50 in available commission. Requested funds are reserved so they cannot be withdrawn twice. Requests undergo review, approval and processing; rejected requests release their reservation, subject to any separately recorded reversal or offset.",
          "Withdrawal requests remain unavailable until identity checks, an approved secure payout method, processing times and any fees have been configured and disclosed before submission. Sensitive banking details must not be exposed in referral activity or ordinary account records.",
          "A request is not a bank transfer. A payout is marked paid only after payment confirmation is recorded. No automatic transfers are offered without an approved and configured payout provider. Participants may have tax responsibilities; obtain qualified advice where needed.",
        ] },
        { title: "6. Milestone study-credit rewards", body: [
          "Each unique 50-referral lifetime milestone qualifies for R79 worth of study credits, up to seven standard awards and R553 of standard reward value per learner per calendar year. Successful-referral counts continue after the annual award cap; the cap does not limit otherwise eligible commissions.",
          "Annual eligibility resets on 1 January in the configured business timezone, initially Africa/Johannesburg. Lifetime totals never reset. Eligible unissued milestones remain recorded and may be processed subject to the new year’s allowance; the same milestone is never awarded twice.",
          "At 300 lifetime successful referrals, a learner qualifies for a permanent Ambassador badge and a separate, once-in-a-lifetime R149 study-credit bonus. This bonus does not use one of the seven annual standard awards. The sixth standard milestone may also qualify at 300. The badge is not removed at year-end.",
        ] },
        { title: "7. Credit conversion, use and expiry", body: [
          "Rand reward values are converted into study credits using an explicitly configured and disclosed conversion rate. Existing subscription and top-up offers use different rates; R1 must not be assumed to equal one credit. Credit issuance stays unavailable until the reward conversion rule has been confirmed.",
          "Rewards use the existing BrainGrasp study-credit balance and are usable only for eligible features under their existing credit rules. Study credits are not monetary commission, cannot be withdrawn as cash, and have no transferable cash value. Any applicable expiry and spending-allocation rules must be disclosed before issuance; no undisclosed expiry is introduced by these draft terms.",
        ] },
        { title: "8. Prohibited conduct and review", body: [
          "Self-referrals, duplicate-account promotions, fabricated identities, payment manipulation, spam, impersonation, misleading income claims and other fraud are prohibited. Do not disclose classmates’ personal information or misrepresent BrainGrasp when sharing a link.",
          "Suspected abuse may require review or suspension. Affected activity and financial adjustments must have a recorded explanation. Contact braingrasp.ai@gmail.com to request an investigation of a decision or an incorrect reward record.",
        ] },
        { title: "9. Changes, interruptions and contact", body: [
          "BrainGrasp may change or suspend the programme with appropriate notice and compliance with applicable law. Changes must not introduce undisclosed retroactive forfeiture of earned rewards. Eligibility and calculations must remain auditable.",
          "AI generation may be queued or paused when capacity or spending limits are reached. Already-generated eligible cached material remains available under existing access rules; referral rewards do not guarantee unlimited new generation.",
          "BrainGrasp — a product of AcademInnovate. Questions about these draft terms: braingrasp.ai@gmail.com. These terms are subject to South African law and do not limit statutory consumer rights.",
        ] },
      ]}
    />
  );
}