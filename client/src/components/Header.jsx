import { useState } from "react";
import styles from "../styles/Header.module.scss";
import { Link } from "react-router-dom";
import { useUser } from "../context/UserProvider";
import AccountMenu from "./AccountMenu";
import FeedbackModal from "../features/nutrition/FeedbackModal";
import NavDrawer from "./NavDrawer";
import { MessageSquare, Menu } from 'lucide-react';

function Header() {
  const { user } = useUser();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <header className={styles.header}>
        {/* Hamburger button — opens the left slide-out nav drawer */}
        <button
          className={styles.hamburgerBtn}
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
        >
          <Menu size={16} aria-hidden="true" style={{ display: 'block' }} />
        </button>

        <Link to="/" className={styles.logo}>
          <span className={styles.title}>Peak</span>
        </Link>

        <div className={styles.headerRight}>
          {/* #60: Feedback icon button — visible on every tab, logged in or not */}
          <button
            className={styles.feedbackBtn}
            onClick={() => setFeedbackOpen(true)}
            aria-label="Send feedback"
            title="Send feedback"
          >
            <MessageSquare className={styles.feedbackIcon} size={16} aria-hidden="true" />
          </button>

          <div className={styles.authLinks}>
            {user == null
              ? (
                <>
                  <Link to="/sign-up" className={styles.transparentButton}>Sign Up</Link>
                  <Link to="/sign-in" className={styles.solidButton}>Sign In</Link>
                </>
              )
              : <AccountMenu />
            }
          </div>
        </div>
      </header>

      {/* #60: FeedbackModal mounted globally at app level via Header */}
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />

      {/* #143: Left slide-out navigation drawer */}
      <NavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
      />
    </>
  );
}

export default Header;
