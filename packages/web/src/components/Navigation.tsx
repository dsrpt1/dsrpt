'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Platform' },
  { href: '/monitor', label: 'Monitor' },
  { href: '/whitepaper', label: 'Research' },
  { href: '/how-it-works', label: 'API' },
  { href: '/team', label: 'Team' },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="main-nav">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`nav-link ${pathname === item.href ? 'active' : ''}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
