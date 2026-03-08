import { useEffect, useRef, useState } from 'react';
import { logout } from '../api/authApi.js';
import { useUser } from '../context/UserProvider.jsx';
import { Profile } from './Icons.jsx';
import ApiKeyModal from './ApiKeyModal.jsx';
import styles from '../styles/Header.module.scss';

function AccountMenu() {
  const { setUser } = useUser();
  const [open, setOpen] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleLogout() {
    setOpen(false);
    await logout();
    setUser(null);
  }

  function handleApiKeys() {
    setOpen(false);
    setShowApiKeys(true);
  }

  return (
    <>
      <div className={styles.accountMenu} ref={menuRef}>
        <button
          className={styles.accountBtn}
          onClick={() => setOpen(o => !o)}
          aria-label="Account menu"
          aria-expanded={open}
        >
          <Profile className={styles.profileIcon} />
        </button>

        {open && (
          <div className={styles.dropdown}>
            <button className={styles.dropdownItem} onClick={handleApiKeys}>
              API Keys
            </button>
            <button className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`} onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}
      </div>

      {showApiKeys && <ApiKeyModal onClose={() => setShowApiKeys(false)} />}
    </>
  );
}

export default AccountMenu;
