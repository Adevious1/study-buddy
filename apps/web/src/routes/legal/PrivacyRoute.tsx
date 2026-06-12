import { Link } from 'react-router-dom';

/* Placeholder copy pending counsel review — structure is real, wording is not
   lawyer-approved. Do not remove sections; replace wording in place. */
export function PrivacyRoute() {
  return (
    <div className="mx-auto max-w-[640px] px-6 py-10">
      <Link to="/login" className="font-body text-[13px] font-bold text-coral">← Back</Link>
      <h1 className="font-display text-[28px] font-extrabold text-ink" style={{ marginTop: 12 }}>
        Privacy Policy
      </h1>
      <div className="font-body text-[14px] text-ink-2" style={{ marginTop: 16, lineHeight: 1.6 }}>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>What we collect</h2>
        <p style={{ marginTop: 8 }}>
          Study Buddy is used by children with a parent or guardian's consent. During tutoring
          sessions we process your child's voice (to talk with Pip), photos your child chooses to
          share (to show Pip their work), session transcripts, and learning-style signals. Your
          guardian account stores your name, email, and subscription state.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>How it's used</h2>
        <p style={{ marginTop: 8 }}>
          Session audio is streamed to our AI tutoring provider to power the conversation and is
          not used to train models. Transcripts, snapshots, and learning profiles are stored so
          you can review your child's progress on the dashboard. We do not sell or share your
          child's data with advertisers.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Deletion</h2>
        <p style={{ marginTop: 8 }}>
          You can permanently delete a child's profile (including all sessions, transcripts, and
          photos) or your entire account at any time from Dashboard → Settings. Deletion is
          immediate and irreversible.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Contact</h2>
        <p style={{ marginTop: 8 }}>Questions? Email privacy@studybuddy.dev.</p>
      </div>
    </div>
  );
}
