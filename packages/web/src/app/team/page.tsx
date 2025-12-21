'use client';

import Link from 'next/link';

// Placeholder team members - replace with actual data
const teamMembers = [
  {
    name: 'Team Member 1',
    role: 'Co-Founder & CEO',
    bio: 'Add bio here...',
    image: null,
    twitter: '',
    linkedin: '',
  },
  {
    name: 'Team Member 2',
    role: 'Co-Founder & CTO',
    bio: 'Add bio here...',
    image: null,
    twitter: '',
    linkedin: '',
  },
  {
    name: 'Team Member 3',
    role: 'Head of Risk',
    bio: 'Add bio here...',
    image: null,
    twitter: '',
    linkedin: '',
  },
];

export default function TeamPage() {
  return (
    <main className="page-container">
      {/* Header */}
      <header className="page-header">
        <Link href="/" className="back-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        <div className="page-title-section">
          <h1>Our Team</h1>
          <p>The people building the future of parametric risk markets</p>
        </div>
      </header>

      {/* Team Grid */}
      <section className="team-grid">
        {teamMembers.map((member, index) => (
          <div key={index} className="team-card">
            <div className="team-avatar">
              {member.image ? (
                <img src={member.image} alt={member.name} />
              ) : (
                <div className="avatar-placeholder">
                  {member.name.split(' ').map(n => n[0]).join('')}
                </div>
              )}
            </div>
            <div className="team-info">
              <h3>{member.name}</h3>
              <span className="team-role">{member.role}</span>
              <p className="team-bio">{member.bio}</p>
              <div className="team-social">
                {member.twitter && (
                  <a href={member.twitter} target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </a>
                )}
                {member.linkedin && (
                  <a href={member.linkedin} target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Advisors Section (optional) */}
      <section className="advisors-section">
        <h2>Advisors</h2>
        <p className="section-subtitle">Coming soon...</p>
      </section>
    </main>
  );
}
