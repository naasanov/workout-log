import { useState } from "react";
import styles from "../styles/Header.module.scss";
import { Link } from "react-router-dom";
import { useUser } from "../context/UserProvider";
import AccountMenu from "./AccountMenu";
import FeedbackModal from "../features/nutrition/FeedbackModal";

function Header() {
  const { user } = useUser();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <header className={styles.header}>
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
            {/* Speech bubble with a heart — clearly "feedback", not settings */}
            <svg
              className={styles.feedbackIcon}
              viewBox="0 0 22 22"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7l-5 4V4a2 2 0 0 1 2-2z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8.5 9.5c0-1.1.9-2 2-2s2 .9 2 2c0 1.5-2 3-2 3s-2-1.5-2-3z"
                fill="currentColor"
              />
            </svg>
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
    </>
  );
}

export default Header;
