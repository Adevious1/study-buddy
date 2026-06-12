import { Link } from 'react-router-dom';

/* Placeholder copy pending counsel review — structure is real, wording is not
   lawyer-approved. Do not remove sections; replace wording in place. */
export function TermsRoute() {
  return (
    <div className="min-h-screen bg-bg">
    <div className="mx-auto max-w-[640px] px-6 py-10">
      <Link to="/login" className="font-body text-[13px] font-bold text-coral">← Back</Link>
      <h1 className="font-display text-[28px] font-extrabold text-ink" style={{ marginTop: 12 }}>
        Terms of Service
      </h1>
      <div className="font-body text-[14px] text-ink-2" style={{ marginTop: 16, lineHeight: 1.6 }}>
        <p>
          Study Buddy provides AI-assisted tutoring for children, managed by a parent or legal
          guardian. By creating an account you confirm you are an adult acting as the child's
          parent or legal guardian.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Subscriptions</h2>
        <p style={{ marginTop: 8 }}>
          Plans are billed per child profile. New accounts start with a free trial; you can manage
          or cancel your subscription from the dashboard at any time. Deleting your account cancels
          your subscription immediately.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Acceptable use</h2>
        <p style={{ marginTop: 8 }}>
          Pip is a tutoring aid, not a substitute for schooling or supervision. Do not attempt to
          extract other users' data or interfere with the service.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Contact</h2>
        <p style={{ marginTop: 8 }}>Questions? Email support@studybuddy.dev.</p>
      </div>
    </div>
    </div>
  );
}
