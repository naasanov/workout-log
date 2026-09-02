import { useState } from "react";
import styles from "../styles/Header.module.scss";
import { Link } from "react-router-dom";
import { useUser } from "../context/UserProvider";
import AccountMenu from "./AccountMenu";
import FeedbackModal from "../features/nutrition/FeedbackModal";
import ChangelogModal from "./ChangelogModal";
import NavDrawer from "./NavDrawer";
import MountainLogo from "./MountainLogo";
import { LATEST_CHANGELOG_DATE } from "../config/changelog";
import { MessageSquare, ScrollText, Menu } from 'lucide-react';

// #314: localStorage key for the last changelog date the user has seen.
const LAST_SEEN_CHANGELOG_KEY = 'peak.lastSeenChangelogDate';

// #314: reads the last-seen changelog date, seeding it to the latest date on
// a first visit so brand-new users never see an unread badge. Falls back to
// "no badge" if localStorage throws (Safari private mode, blocked storage).
function readLastSeenChangelogDate() {
  try {
    const stored = localStorage.getItem(LAST_SEEN_CHANGELOG_KEY);
    if (stored != null) return stored;
    localStorage.setItem(LAST_SEEN_CHANGELOG_KEY, LATEST_CHANGELOG_DATE);
    return LATEST_CHANGELOG_DATE;
  } catch (_) {
    return LATEST_CHANGELOG_DATE;
  }
}

function writeLastSeenChangelogDate() {
  try {
    localStorage.setItem(LAST_SEEN_CHANGELOG_KEY, LATEST_CHANGELOG_DATE);
  } catch (_) {
    // Best-effort; nothing to do if storage is unavailable.
  }
}

/**
 * Header.
 *
 * The nav drawer's open/edit state is *optionally controlled*: pass
 * `drawerOpen` + `onDrawerOpenChange` (and optionally `editMode`) to drive it
 * from a parent (Workouts does this so the empty-state CTA can open the drawer
 * in edit mode). When those props are omitted (SignIn/SignUp), Header manages
 * the state internally.
 */
function Header({
  drawerOpen: controlledOpen,
  onDrawerOpenChange,
  editMode: controlledEditMode,
  onEditModeChange,
}) {
  const { user } = useUser();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalEditMode, setInternalEditMode] = useState(false);
  // #314: lazy init so localStorage is only read once, on mount.
  const [hasUnreadChangelog, setHasUnreadChangelog] = useState(
    () => readLastSeenChangelogDate() < LATEST_CHANGELOG_DATE
  );

  const openChangelog = () => {
    setChangelogOpen(true);
    writeLastSeenChangelogDate();
    setHasUnreadChangelog(false);
  };

  const isControlled = controlledOpen !== undefined;
  const drawerOpen = isControlled ? controlledOpen : internalOpen;
  const setDrawerOpen = isControlled ? onDrawerOpenChange : setInternalOpen;

  const editMode = controlledEditMode !== undefined ? controlledEditMode : internalEditMode;
  const setEditMode = onEditModeChange ?? setInternalEditMode;

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditMode(false);
  };

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
          <MountainLogo className={styles.mountainLogo} />
          <span className={styles.title}>Peak</span>
        </Link>

        <div className={styles.headerRight}>
          {/* #258: Feedback icon button — only for signed-in users. POST
              /api/feedback requires auth, so a signed-out user would fill
              out the form and get a 401; hide the entry point instead. */}
          {user != null && (
            <button
              className={styles.feedbackBtn}
              onClick={() => setFeedbackOpen(true)}
              aria-label="Send feedback"
              title="Send feedback"
            >
              <MessageSquare className={styles.feedbackIcon} size={16} aria-hidden="true" />
            </button>
          )}

          {/* #295: Changelog icon button — a static client-side list with no
              request behind it, so unlike feedback it's shown when signed out too. */}
          <button
            className={styles.changelogBtn}
            onClick={openChangelog}
            aria-label={hasUnreadChangelog ? "What's new (unread updates)" : "What's new"}
            title="What's new"
          >
            <ScrollText className={styles.changelogIcon} size={16} aria-hidden="true" />
            {/* #314: unread dot, decorative only; state is on aria-label above. */}
            {hasUnreadChangelog && (
              <span className={styles.changelogBadge} aria-hidden="true" />
            )}
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

      {/* #295: ChangelogModal mounted globally at app level via Header */}
      <ChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
      />

      {/* #143: Left slide-out navigation drawer */}
      <NavDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        user={user}
        editMode={editMode}
        onEditModeChange={setEditMode}
      />
    </>
  );
}

export default Header;
