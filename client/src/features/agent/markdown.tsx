/**
 * Shared react-markdown configuration for the chat bubble and process
 * timeline. Both usages need GFM (tables, strikethrough, autolinks, task
 * lists) and a table override that keeps wide tables scrollable in a bubble.
 */
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './AgentChat.module.scss';

// Module-level so ReactMarkdown never receives a new plugins array on
// every render.
export const markdownPlugins = [remarkGfm];

// remark-gfm task-list checkboxes already render disabled by default
// (mdast-util-to-hast marks them `disabled: true`), so no override is
// needed there; only the table wrapper needs one.
export const markdownComponents: Components = {
  table: ({ children }) => (
    <div className={styles.tableScroll}>
      <table>{children}</table>
    </div>
  ),
};
