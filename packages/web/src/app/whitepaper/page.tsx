'use client';

import Link from 'next/link';

const sections = [
  {
    id: 'abstract',
    title: 'Abstract',
    content: 'Add whitepaper abstract here...',
  },
  {
    id: 'introduction',
    title: '1. Introduction',
    content: 'Add introduction content here...',
  },
  {
    id: 'problem',
    title: '2. Problem Statement',
    content: 'Add problem statement here...',
  },
  {
    id: 'solution',
    title: '3. Solution Architecture',
    content: 'Add solution architecture here...',
  },
  {
    id: 'mechanism',
    title: '4. Risk Mechanism Design',
    content: 'Add risk mechanism details here...',
  },
  {
    id: 'tokenomics',
    title: '5. Tokenomics',
    content: 'Add tokenomics here...',
  },
  {
    id: 'roadmap',
    title: '6. Roadmap',
    content: 'Add roadmap here...',
  },
  {
    id: 'team',
    title: '7. Team',
    content: 'Add team section here...',
  },
  {
    id: 'references',
    title: 'References',
    content: 'Add references here...',
  },
];

export default function WhitepaperPage() {
  return (
    <main className="page-container whitepaper-page">
      {/* Header */}
      <header className="page-header">
        <Link href="/" className="back-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        <div className="page-title-section">
          <h1>Whitepaper</h1>
          <p>DSRPT Protocol: Parametric Risk Markets for DeFi</p>
          <span className="version-badge">Version 1.0 | December 2024</span>
        </div>
        <div className="whitepaper-actions">
          <button className="download-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download PDF
          </button>
        </div>
      </header>

      {/* Table of Contents */}
      <aside className="toc-sidebar">
        <h3>Contents</h3>
        <nav className="toc-nav">
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="toc-link">
              {section.title}
            </a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <article className="whitepaper-content">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="wp-section">
            <h2>{section.title}</h2>
            <p>{section.content}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
