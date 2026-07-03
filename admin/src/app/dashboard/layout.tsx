"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAuthenticated, logout } from "@/lib/auth";
import styles from "./dashboard.module.css";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/dashboard/hostels", label: "Hostels", icon: "🏠" },
  { href: "/dashboard/windows", label: "Check-in Windows", icon: "🕐" },
  { href: "/dashboard/students", label: "Students", icon: "👤" },
  { href: "/dashboard/enrollments", label: "Enrollments", icon: "📋" },
  { href: "/dashboard/attendance", label: "Attendance", icon: "✅" },
  { href: "/dashboard/leave", label: "Leave Requests", icon: "🗓" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <div className={styles.loading}>
        <div className="skeleton skeleton-title" style={{ width: 180 }} />
      </div>
    );
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <div className={styles.shell}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className={styles.overlay}
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
          role="button"
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={styles.brand}>
          <span className={styles.brandIcon}>🏠</span>
          <span className={styles.brandText}>HostelAdmin</span>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`${styles.navLink} ${isActive(item.href) ? styles.navActive : ""}`}
              onClick={(e) => {
                e.preventDefault();
                router.push(item.href);
              }}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <button
            className={`btn btn-ghost ${styles.logoutBtn}`}
            onClick={logout}
          >
            ↪ Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className={styles.main}>
        {/* Topbar */}
        <header className={styles.topbar}>
          <button
            className={`btn btn-ghost btn-icon ${styles.hamburger}`}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle menu"
          >
            ☰
          </button>
          <div className={styles.topbarSpacer} />
          <span className={styles.adminName}>Admin</span>
        </header>

        {/* Content */}
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
